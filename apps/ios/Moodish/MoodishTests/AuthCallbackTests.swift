import XCTest
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
}
