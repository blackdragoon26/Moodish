import XCTest
import CryptoKit
@testable import Moodish

final class AuthCallbackTests: XCTestCase {
    func testReturnsTheCodeForTheAppToExchange() throws {
        XCTAssertEqual(try GoogleAuthSession.callbackValue(from: URL(string: "moodish://auth-callback?code=abc123")!, parameter: "code"), "abc123")
    }

    func testServerFailureReasonsBecomeReadableMessages() {
        let expectations = ["declined": "cancelled", "expired": "expired", "exchange_failed": "did not complete", "something-new": "Couldn't complete"]
        for (reason, fragment) in expectations {
            XCTAssertThrowsError(try GoogleAuthSession.callbackValue(from: URL(string: "moodish://auth-callback?error=\(reason)")!, parameter: "code")) { error in
                guard case let APIError.server(_, message) = error else { return XCTFail("unexpected error \(error)") }
                XCTAssertTrue(message.contains(fragment), "\(reason) -> \(message)")
            }
        }
    }

    func testRejectsCallbacksWithoutTheValueOrFromAnotherScheme() {
        XCTAssertThrowsError(try GoogleAuthSession.callbackValue(from: URL(string: "moodish://auth-callback")!, parameter: "code"))
        XCTAssertThrowsError(try GoogleAuthSession.callbackValue(from: URL(string: "https://evil.example/?code=abc")!, parameter: "code"))
    }

    func testPKCEChallengeIsTheS256OfAFreshVerifier() throws {
        let a = try PKCE.generate(), b = try PKCE.generate()
        XCTAssertEqual(a.verifier.count, 43)
        XCTAssertNotEqual(a.verifier, b.verifier)
        XCTAssertEqual(a.challenge, PKCE.base64url(Data(SHA256.hash(data: Data(a.verifier.utf8)))))
    }

    func testGoogleStartURLCarriesTheChallenge() throws {
        let api = APIClient(sessionStore: SessionStore())
        let items = URLComponents(url: api.googleMobileAuthorizeURL(challenge: "abc"), resolvingAgainstBaseURL: false)?.queryItems ?? []
        XCTAssertEqual(Set(items.map { "\($0.name)=\($0.value ?? "")" }), ["client=mobile", "challenge=abc"])
    }

    func testATokenCallbackIsNotAcceptedAsACode() {
        XCTAssertThrowsError(try GoogleAuthSession.callbackValue(from: URL(string: "moodish://auth-callback?token=abc")!, parameter: "code"))
    }

    func testGoogleAndSwiggyFailuresShareProviderNeutralMessages() {
        for reason in ["declined", "exchange_failed"] {
            XCTAssertThrowsError(try GoogleAuthSession.callbackValue(from: URL(string: "moodish://auth-callback?error=\(reason)")!, parameter: "code")) { error in
                guard case let APIError.server(_, message) = error else { return XCTFail("\(error)") }
                XCTAssertFalse(message.contains("Swiggy"), message)
            }
        }
    }

    func testKeychainOverwriteKeepsTheLatestValue() {
        XCTAssertTrue(KeychainStore.set("first", forKey: "moodish.test.overwrite"))
        XCTAssertTrue(KeychainStore.set("second", forKey: "moodish.test.overwrite"))
        XCTAssertEqual(KeychainStore.get("moodish.test.overwrite"), "second")
        KeychainStore.remove("moodish.test.overwrite")
    }

    func testKeychainReportsASuccessfulWrite() {
        XCTAssertTrue(KeychainStore.set("value", forKey: "moodish.test.write"))
        XCTAssertEqual(KeychainStore.get("moodish.test.write"), "value")
        KeychainStore.remove("moodish.test.write")
    }
}
