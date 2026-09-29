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
            "exchange_failed": "Swiggy did not complete the connection. Try again."
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
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { throw APIError.server(status: 0, message: "Could not start secure login") }
        func base64url(_ data: Data) -> String { data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "") }
        let verifier = base64url(Data(bytes))
        let challenge = base64url(Data(SHA256.hash(data: Data(verifier.utf8))))
        let started = try await api.startSwiggy(challenge: challenge)
        guard let url = URL(string: started.authorizationUrl) else { throw APIError.server(status: 0, message: "Invalid login URL") }
        let code = try await signIn(authorizeURL: url, parameter: "code")
        return try await api.exchangeMobile(code: code, verifier: verifier).token
    }

    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            UIApplication.shared.connectedScenes
                .compactMap { ($0 as? UIWindowScene)?.keyWindow }
                .first ?? ASPresentationAnchor()
        }
    }
}
