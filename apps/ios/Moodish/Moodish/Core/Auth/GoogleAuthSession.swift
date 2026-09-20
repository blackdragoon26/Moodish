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
                    continuation.resume(throwing: error)
                    return
                }
                guard
                    let callbackURL,
                    let token = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false)?
                        .queryItems?.first(where: { $0.name == parameter })?.value
                else {
                    continuation.resume(throwing: APIError.server(status: 0, message: "Sign-in did not return the expected callback"))
                    return
                }
                continuation.resume(returning: token)
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = true
            self.session = session
            if !session.start() { continuation.resume(throwing: APIError.server(status: 0, message: "Could not open sign-in")) }
        }
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
