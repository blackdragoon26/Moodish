import XCTest
@testable import Moodish

/// Captures requests instead of sending them.
final class RecordingProtocol: URLProtocol {
    nonisolated(unsafe) static var requests: [URLRequest] = []
    nonisolated(unsafe) static var responseBody = Data("{}".utf8)
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.requests.append(request)
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: ["content-type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Self.responseBody)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

final class APIClientSessionTests: XCTestCase {
    private var store: SessionStore!
    private var api: APIClient!

    override func setUp() {
        RecordingProtocol.requests = []
        store = SessionStore()
        store.setSessionToken("personal-token")
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [RecordingProtocol.self]
        api = APIClient(sessionStore: store, configuration: configuration)
    }

    override func tearDown() { store.setSessionToken(nil) }

    func testPersonalRequestsCarryOnlyThePersonalSession() async throws {
        RecordingProtocol.responseBody = Data(#"{"connected":true,"state":"connected","selectedAddressId":"addr-1"}"#.utf8)
        _ = try await api.swiggyConnection()
        let request = try XCTUnwrap(RecordingProtocol.requests.last)
        XCTAssertEqual(request.value(forHTTPHeaderField: "authorization"), "Bearer personal-token")
        XCTAssertNil(request.value(forHTTPHeaderField: "x-moodish-session"))
    }

    func testGroupPurchasingCallsCarryBothCredentialsSeparately() async throws {
        RecordingProtocol.responseBody = Data(#"{"preparationId":"p","restaurantId":"r","address":{"id":"a","label":"Home","display":"x"},"items":[],"estimatedItemTotal":0,"existingCart":{},"replacesExistingCart":false,"note":"n"}"#.utf8)
        _ = try await api.prepareGroupCart(sessionId: "group-1", restaurantId: nil, bearerToken: "group-token")
        let request = try XCTUnwrap(RecordingProtocol.requests.last)
        XCTAssertEqual(request.url?.path, "/api/group-sessions/group-1/prepare-cart")
        XCTAssertEqual(request.value(forHTTPHeaderField: "authorization"), "Bearer group-token")
        XCTAssertEqual(request.value(forHTTPHeaderField: "x-moodish-session"), "personal-token")
    }

    func testTheSessionTokenSurvivesARestartAndLogoutClearsIt() {
        XCTAssertEqual(SessionStore().sessionToken, "personal-token", "a new store reads the Keychain like a relaunched app")
        store.logout()
        XCTAssertNil(SessionStore().sessionToken)
    }

    func testParticipantTokenIsKeptAndSentOnLaterAnswers() async throws {
        let session = "group-\(UUID().uuidString)"
        let json = #"{"sessionId":"S","state":"collecting","headcount":2,"budgetPerPerson":300,"approvalMode":"team_vote""#
        RecordingProtocol.responseBody = Data((json.replacingOccurrences(of: "\"S\"", with: "\"\(session)\"") + #","participantToken":"issued-token"}"#).utf8)
        _ = try await api.submitPreferences(sessionId: session, participantId: "p1", dietMode: "both", mood: "biryani", dietaryRules: nil, allergies: nil, invitePasscode: "CODE", bearerToken: nil)
        XCTAssertEqual(store.participantToken(sessionId: session, participantId: "p1"), "issued-token")
        RecordingProtocol.responseBody = Data((json.replacingOccurrences(of: "\"S\"", with: "\"\(session)\"") + "}").utf8)
        _ = try await api.submitPreferences(sessionId: session, participantId: "p1", dietMode: "both", mood: "spicy biryani", dietaryRules: nil, allergies: nil, invitePasscode: "CODE", bearerToken: nil)
        let body = try XCTUnwrap(RecordingProtocol.requests.last.flatMap { $0.httpBodyStream }.map { stream -> Data in
            stream.open(); defer { stream.close() }
            var data = Data(); var buffer = [UInt8](repeating: 0, count: 1024)
            while stream.hasBytesAvailable { let n = stream.read(&buffer, maxLength: buffer.count); if n <= 0 { break }; data.append(buffer, count: n) }
            return data
        } ?? RecordingProtocol.requests.last?.httpBody)
        let sent = try JSONSerialization.jsonObject(with: body) as? [String: Any]
        XCTAssertEqual(sent?["participantToken"] as? String, "issued-token")
        XCTAssertEqual(store.participantToken(sessionId: session, participantId: "p1"), "issued-token", "no new token is issued on edits")
    }
}
