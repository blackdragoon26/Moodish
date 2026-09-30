import Foundation

/// Owns the personal-session bearer token and per-group-session access
/// tokens/participant ids. Backed by Keychain so tokens survive relaunch,
/// mirroring the web app's persisted cookie / localStorage identifiers.
@Observable
final class SessionStore {
    private static let sessionTokenKey = "moodish.session.token"
    private static let groupTokenPrefix = "moodish.group.token."
    private static let participantIdPrefix = "moodish.group.participant."
    private static let participantTokenPrefix = "moodish.group.participantToken."

    private(set) var sessionToken: String?
    /// True when the Keychain refused the last sign-in; it then lasts only
    /// until the app is closed. Settings tells the person.
    private(set) var sessionNotSaved = false

    init() {
        sessionToken = KeychainStore.get(Self.sessionTokenKey)
    }

    func setSessionToken(_ token: String?) {
        sessionToken = token
        if let token {
            sessionNotSaved = !KeychainStore.set(token, forKey: Self.sessionTokenKey)
        } else {
            sessionNotSaved = false
            KeychainStore.remove(Self.sessionTokenKey)
        }
    }

    func groupAccessToken(sessionId: String) -> String? {
        KeychainStore.get(Self.groupTokenPrefix + sessionId)
    }

    func setGroupAccessToken(_ token: String, sessionId: String) {
        KeychainStore.set(token, forKey: Self.groupTokenPrefix + sessionId)
    }

    func participantId(sessionId: String) -> String? {
        KeychainStore.get(Self.participantIdPrefix + sessionId)
    }

    func setParticipantId(_ id: String, sessionId: String) {
        KeychainStore.set(id, forKey: Self.participantIdPrefix + sessionId)
    }

    func participantToken(sessionId: String, participantId: String) -> String? {
        KeychainStore.get(Self.participantTokenPrefix + sessionId + "." + participantId)
    }

    func setParticipantToken(_ token: String, sessionId: String, participantId: String) {
        KeychainStore.set(token, forKey: Self.participantTokenPrefix + sessionId + "." + participantId)
    }

    func logout() {
        setSessionToken(nil)
    }
}
