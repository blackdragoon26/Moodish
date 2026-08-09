import 'recommendation_models.dart';

enum GroupApprovalMode {
  managerDecides('manager_decides', 'Manager decides'),
  teamVote('team_vote', 'Team votes'),
  automatic('automatic', 'Automatic');

  final String value;
  final String displayName;
  const GroupApprovalMode(this.value, this.displayName);

  static GroupApprovalMode fromValue(String? value) =>
      GroupApprovalMode.values.firstWhere((m) => m.value == value, orElse: () => GroupApprovalMode.managerDecides);
}

enum GroupSessionState {
  collecting,
  locked,
  ranking,
  voting,
  awaitingManager,
  awaitingCreatorConfirmation,
  cartBuilt,
  cancelled,
  expired,
  unknown;

  static GroupSessionState fromValue(String? value) {
    switch (value) {
      case 'collecting':
        return GroupSessionState.collecting;
      case 'locked':
        return GroupSessionState.locked;
      case 'ranking':
        return GroupSessionState.ranking;
      case 'voting':
        return GroupSessionState.voting;
      case 'awaiting_manager':
        return GroupSessionState.awaitingManager;
      case 'awaiting_creator_confirmation':
        return GroupSessionState.awaitingCreatorConfirmation;
      case 'cart_built':
        return GroupSessionState.cartBuilt;
      case 'cancelled':
        return GroupSessionState.cancelled;
      case 'expired':
        return GroupSessionState.expired;
      default:
        return GroupSessionState.unknown;
    }
  }

  bool get isActive => this != GroupSessionState.cartBuilt && this != GroupSessionState.cancelled && this != GroupSessionState.expired;

  String get label {
    switch (this) {
      case GroupSessionState.collecting:
        return 'Collecting responses';
      case GroupSessionState.locked:
        return 'Locked';
      case GroupSessionState.ranking:
        return 'Ranking options';
      case GroupSessionState.voting:
        return 'Team is voting';
      case GroupSessionState.awaitingManager:
        return 'Awaiting manager approval';
      case GroupSessionState.awaitingCreatorConfirmation:
        return 'Awaiting creator confirmation';
      case GroupSessionState.cartBuilt:
        return 'Cart built';
      case GroupSessionState.cancelled:
        return 'Cancelled';
      case GroupSessionState.expired:
        return 'Expired';
      case GroupSessionState.unknown:
        return 'Unknown';
    }
  }
}

/// `dietaryRules`/`allergies` are always returned as arrays by the server
/// (group-service.mjs `cleanRules`), even though the submission request
/// body accepts either a comma string or an array.
class GroupSubmission {
  final String participantId;
  final String? dietMode;
  final String? mood;
  final List<String> dietaryRules;
  final List<String> allergies;

  GroupSubmission({required this.participantId, this.dietMode, this.mood, this.dietaryRules = const [], this.allergies = const []});

  factory GroupSubmission.fromJson(Map<String, dynamic> json) => GroupSubmission(
        participantId: json['participantId'] as String? ?? '',
        dietMode: json['dietMode'] as String?,
        mood: json['mood'] as String?,
        dietaryRules: (json['dietaryRules'] as List<dynamic>? ?? []).map((e) => e.toString()).toList(),
        allergies: (json['allergies'] as List<dynamic>? ?? []).map((e) => e.toString()).toList(),
      );
}

/// Union of the backend's public and private group-session views: fields
/// only the manager/creator can see (submissions, recommendation, cart)
/// are simply absent when the server returns the public shape.
class GroupSession {
  final String sessionId;
  final GroupSessionState state;
  final int headcount;
  final num budgetPerPerson;
  final GroupApprovalMode approvalMode;
  final bool invitePasscodeRequired;
  final List<RecommendationOption> options;
  final Map<String, int> voteCounts;
  final String? selectedOptionId;
  final String? creatorId;
  final List<GroupSubmission> submissions;
  final RecommendationRun? recommendation;
  final CartConfirmResult? cart;

  /// Only present in the POST /api/group-sessions creation response.
  final String? invitePasscode;
  final String? accessToken;

  GroupSession({
    required this.sessionId,
    required this.state,
    required this.headcount,
    required this.budgetPerPerson,
    required this.approvalMode,
    this.invitePasscodeRequired = false,
    this.options = const [],
    this.voteCounts = const {},
    this.selectedOptionId,
    this.creatorId,
    this.submissions = const [],
    this.recommendation,
    this.cart,
    this.invitePasscode,
    this.accessToken,
  });

  factory GroupSession.fromJson(Map<String, dynamic> json) => GroupSession(
        sessionId: json['sessionId'] as String? ?? '',
        state: GroupSessionState.fromValue(json['state'] as String?),
        headcount: json['headcount'] as int? ?? 0,
        budgetPerPerson: json['budgetPerPerson'] as num? ?? 0,
        approvalMode: GroupApprovalMode.fromValue(json['approvalMode'] as String?),
        invitePasscodeRequired: json['invitePasscodeRequired'] == true,
        options: (json['options'] as List<dynamic>? ?? [])
            .map((e) => RecommendationOption.fromJson(e as Map<String, dynamic>))
            .toList(),
        voteCounts: (json['voteCounts'] as Map<String, dynamic>? ?? {}).map((k, v) => MapEntry(k, v as int)),
        selectedOptionId: json['selectedOptionId'] as String?,
        creatorId: json['creatorId'] as String?,
        submissions: (json['submissions'] as List<dynamic>? ?? [])
            .map((e) => GroupSubmission.fromJson(e as Map<String, dynamic>))
            .toList(),
        recommendation:
            json['recommendation'] != null ? RecommendationRun.fromJson(json['recommendation'] as Map<String, dynamic>) : null,
        cart: json['cart'] != null ? CartConfirmResult.fromJson(json['cart'] as Map<String, dynamic>) : null,
        invitePasscode: json['invitePasscode'] as String?,
        accessToken: json['accessToken'] as String?,
      );
}
