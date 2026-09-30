import AuthenticationServices
import Foundation
import UIKit
import CryptoKit
import Security

/// Drives the native Google login handoff: opens the agent's
/// `/api/auth/google/start?client=mobile` authorize URL in an
/// `ASWebAuthenticationSession`, and the mobile-aware server redirects
/// back to `moodish://auth-callback?token=...` (see services/agent/src/auth.mjs).
@MainActor
final class GoogleAuthSession: NSObject, ASWebAuthenticationPresentationContextProviding {
    private var session: ASWebAuthenticationSession?

    func signIn(authorizeURL: URL, parameter: String = "token") async throws -> String {
        try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(url: authorizeURL, callbackURLScheme: "moodish") { callbackURL, error in
                if let error {
                    let cancelled = (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin
                    continuation.resume(throwing: cancelled ? APIError.server(status: 0, message: "Sign-in was cancelled. Nothing was changed.") : error)
                    return
                }
                guard let callbackURL else {
                    continuation.resume(throwing: APIError.server(status: 0, message: "Sign-in did not return the expected callback"))
                    return
                }
                continuation.resume(with: Result { try Self.callbackValue(from: callbackURL, parameter: parameter) })
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = true
            self.session = session
            if !session.start() { continuation.resume(throwing: APIError.server(status: 0, message: "Could not open sign-in")) }
        }
    }

    /// Reads the value Moodish's server put on `moodish://auth-callback`, or turns
    /// its short failure reason into something a person can act on.
    nonisolated static func callbackValue(from url: URL, parameter: String) throws -> String {
        let reasons = [
            "declined": "Swiggy connection was cancelled. Nothing was changed.",
            "expired": "That sign-in expired or was already used. Try again.",
            "browser_mismatch": "Finish sign-in in the window where you started it.",
            "exchange_failed": "Swiggy did not complete the connection. Try again.",
            "update_required": "Update Moodish to sign in."
        ]
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        if let reason = items.first(where: { $0.name == "error" })?.value {
            throw APIError.server(status: 0, message: reasons[reason] ?? "Couldn't complete sign-in. Try again.")
        }
        guard url.scheme == "moodish", let value = items.first(where: { $0.name == parameter })?.value, !value.isEmpty else {
            throw APIError.server(status: 0, message: "Sign-in did not return the expected callback")
        }
        return value
    }

    func connectSwiggy(api: APIClient) async throws -> String {
        let pkce = try PKCE.generate()
        let started = try await api.startSwiggy(challenge: pkce.challenge)
        guard let url = URL(string: started.authorizationUrl) else { throw APIError.server(status: 0, message: "Invalid login URL") }
        let code = try await signIn(authorizeURL: url, parameter: "code")
        return try await api.exchangeMobile(code: code, verifier: pkce.verifier).token
    }

    /// Google sign-in ends in the same verifier-checked exchange as Swiggy.
    func signInWithGoogle(api: APIClient) async throws -> String {
        let pkce = try PKCE.generate()
        let code = try await signIn(authorizeURL: api.googleMobileAuthorizeURL(challenge: pkce.challenge), parameter: "code")
        return try await api.exchangeMobile(code: code, verifier: pkce.verifier).token
    }

    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            UIApplication.shared.connectedScenes
                .compactMap { ($0 as? UIWindowScene)?.keyWindow }
                .first ?? ASPresentationAnchor()
        }
    }
}

/// A PKCE verifier and its S256 challenge.
struct PKCE {
    let verifier: String
    let challenge: String

    static func generate() throws -> PKCE {
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { throw APIError.server(status: 0, message: "Could not start secure login") }
        let verifier = base64url(Data(bytes))
        return PKCE(verifier: verifier, challenge: base64url(Data(SHA256.hash(data: Data(verifier.utf8)))))
    }

    static func base64url(_ data: Data) -> String {
        data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
}
