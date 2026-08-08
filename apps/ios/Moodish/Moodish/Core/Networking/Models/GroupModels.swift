import Foundation

enum GroupApprovalMode: String, Codable, CaseIterable, Identifiable {
    case managerDecides = "manager_decides"
    case teamVote = "team_vote"
    case automatic = "automatic"

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .managerDecides: return "Manager decides"
        case .teamVote: return "Team votes"
        case .automatic: return "Automatic"
        }
    }
}

enum GroupSessionState: String, Codable {
    case collecting
    case locked
    case ranking
    case voting
    case awaitingManager = "awaiting_manager"
    case awaitingCreatorConfirmation = "awaiting_creator_confirmation"
    case cartBuilt = "cart_built"
    case cancelled
    case expired
    case unknown

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = GroupSessionState(rawValue: raw) ?? .unknown
    }

    var isActive: Bool {
        switch self {
        case .cartBuilt, .cancelled, .expired: return false
        default: return true
        }
    }
}

struct GroupAggregate: Codable, Equatable {
    let vegCount: Int?
    let nonVegCount: Int?
    let bothCount: Int?
    let restrictionCounts: [String: Int]?
    let allergySubmissionCount: Int?
}

struct GroupSubmission: Codable, Equatable, Identifiable {
    var id: String { participantId }
    let participantId: String
    let dietMode: String?
    let mood: String?
    let dietaryRules: [String]?
    let allergies: [String]?
    let discoveryMode: String?
}

/// Union of the backend's public and private group-session views: fields
/// only the manager/creator can see (submissions, recommendation, cart)
/// are simply nil when the server returns the public shape.
struct GroupSession: Codable, Equatable, Identifiable {
    var id: String { sessionId }
    let sessionId: String
    let platform: String?
    let state: GroupSessionState
    let headcount: Int
    let responseCount: Int?
    let responseDeadline: String?
    let budgetPerPerson: Double
    let totalBudget: Double?
    let vibe: String?
    let servingStyle: String?
    let approvalMode: GroupApprovalMode
    let invitePasscodeRequired: Bool?
    let aggregate: GroupAggregate?
    let options: [RecommendationOption]?
    let voteCounts: [String: Int]?
    let selectedOptionId: String?
    let updatedAt: String?
    let creatorId: String?
    let coManagerIds: [String]?
    let submissions: [GroupSubmission]?
    let recommendation: RecommendationRun?
    let cart: CartConfirmResult?
    /// Only present in the `POST /api/group-sessions` creation response —
    /// the manager needs this to hand to teammates for the passcode-gated
    /// join flow (see ParticipantJoinView).
    let invitePasscode: String?
    /// Only present in the `POST /api/group-sessions` creation response.
    let accessToken: String?
}

struct CreateGroupSessionRequest: Encodable {
    let creatorId: String
    let headcount: Int
    let budgetPerPerson: Double
    let approvalMode: String
    let vibe: String?
    let platform: String = "web"
}
