/// `itemId` is present on personal-recommendation items but absent on the
/// lighter {name, quantity} items a group session's ranked `options` return
/// (group-service.mjs coverage options) — nullable here so both shapes parse.
class MealItem {
  final String? itemId;
  final String name;
  final int? quantity;
  final String? restaurantId;
  final String? restaurantName;
  final List<String> tags;

  MealItem({this.itemId, required this.name, this.quantity, this.restaurantId, this.restaurantName, this.tags = const []});

  factory MealItem.fromJson(Map<String, dynamic> json) => MealItem(
        itemId: json['itemId'] as String?,
        name: json['name'] as String? ?? '',
        quantity: json['quantity'] as int?,
        restaurantId: json['restaurantId'] as String?,
        restaurantName: json['restaurantName'] as String?,
        tags: (json['tags'] as List<dynamic>? ?? []).map((e) => e.toString()).toList(),
      );
}

class AddOnProduct {
  final String productId;
  final String name;
  final num price;
  final String? pairingReason;

  AddOnProduct({required this.productId, required this.name, required this.price, this.pairingReason});

  factory AddOnProduct.fromJson(Map<String, dynamic> json) => AddOnProduct(
        productId: json['productId'] as String? ?? '',
        name: json['name'] as String? ?? '',
        price: json['price'] as num? ?? 0,
        pairingReason: json['pairingReason'] as String?,
      );
}

class RecommendationOption {
  final String optionId;
  final String restaurantName;
  final String? cuisine;
  final List<MealItem> items;
  final num estimatedTotal;
  final num? rating;
  final num? distanceKm;
  final String? matchType;
  final List<String> reasons;

  RecommendationOption({
    required this.optionId,
    required this.restaurantName,
    this.cuisine,
    this.items = const [],
    required this.estimatedTotal,
    this.rating,
    this.distanceKm,
    this.matchType,
    this.reasons = const [],
  });

  factory RecommendationOption.fromJson(Map<String, dynamic> json) => RecommendationOption(
        optionId: json['optionId'] as String? ?? '',
        restaurantName: json['restaurantName'] as String? ?? '',
        cuisine: json['cuisine'] as String?,
        items: (json['items'] as List<dynamic>? ?? []).map((e) => MealItem.fromJson(e as Map<String, dynamic>)).toList(),
        estimatedTotal: json['estimatedTotal'] as num? ?? 0,
        rating: json['rating'] as num?,
        distanceKm: json['distanceKm'] as num?,
        matchType: json['matchType'] as String?,
        reasons: (json['reasons'] as List<dynamic>? ?? []).map((e) => e.toString()).toList(),
      );
}

/// Personal recommendations return `orderPlacementEnabled`; the office/group
/// variant instead returns `groupPaymentSupported`/`scheduledDeliverySupported`
/// (recommender.mjs office path) — all nullable here so both shapes parse.
class SafetyInfo {
  final bool requiresCartConfirmation;
  final bool? orderPlacementEnabled;
  final bool? groupPaymentSupported;
  final bool? scheduledDeliverySupported;
  final String? note;

  SafetyInfo({
    required this.requiresCartConfirmation,
    this.orderPlacementEnabled,
    this.groupPaymentSupported,
    this.scheduledDeliverySupported,
    this.note,
  });

  factory SafetyInfo.fromJson(Map<String, dynamic> json) => SafetyInfo(
        requiresCartConfirmation: json['requiresCartConfirmation'] == true,
        orderPlacementEnabled: json['orderPlacementEnabled'] as bool?,
        groupPaymentSupported: json['groupPaymentSupported'] as bool?,
        scheduledDeliverySupported: json['scheduledDeliverySupported'] as bool?,
        note: json['note'] as String?,
      );
}

class DemoInfo {
  final bool active;
  final String? label;
  final String? note;

  DemoInfo({required this.active, this.label, this.note});

  factory DemoInfo.fromJson(Map<String, dynamic> json) =>
      DemoInfo(active: json['active'] == true, label: json['label'] as String?, note: json['note'] as String?);
}

class RecommendationRun {
  final String recommendationId;
  final String? mode;
  final List<RecommendationOption> options;
  final List<AddOnProduct> addOns;
  final String? summary;
  final DemoInfo? demo;
  final SafetyInfo? safety;

  RecommendationRun({
    required this.recommendationId,
    this.mode,
    this.options = const [],
    this.addOns = const [],
    this.summary,
    this.demo,
    this.safety,
  });

  factory RecommendationRun.fromJson(Map<String, dynamic> json) => RecommendationRun(
        recommendationId: json['recommendationId'] as String? ?? '',
        mode: json['mode'] as String?,
        options: (json['options'] as List<dynamic>? ?? [])
            .map((e) => RecommendationOption.fromJson(e as Map<String, dynamic>))
            .toList(),
        addOns:
            (json['addOns'] as List<dynamic>? ?? []).map((e) => AddOnProduct.fromJson(e as Map<String, dynamic>)).toList(),
        summary: json['summary'] as String?,
        demo: json['demo'] != null ? DemoInfo.fromJson(json['demo'] as Map<String, dynamic>) : null,
        safety: json['safety'] != null ? SafetyInfo.fromJson(json['safety'] as Map<String, dynamic>) : null,
      );
}

class CartSummary {
  final String? restaurant;
  final List<MealItem> items;
  final num? total;

  CartSummary({this.restaurant, this.items = const [], this.total});

  factory CartSummary.fromJson(Map<String, dynamic> json) => CartSummary(
        restaurant: json['restaurant'] as String?,
        items: (json['items'] as List<dynamic>? ?? []).map((e) => MealItem.fromJson(e as Map<String, dynamic>)).toList(),
        total: json['total'] as num?,
      );
}

class InstamartPreview {
  final List<AddOnProduct> items;
  final num? total;
  final String? note;

  InstamartPreview({this.items = const [], this.total, this.note});

  factory InstamartPreview.fromJson(Map<String, dynamic> json) => InstamartPreview(
        items: (json['items'] as List<dynamic>? ?? []).map((e) => AddOnProduct.fromJson(e as Map<String, dynamic>)).toList(),
        total: json['total'] as num?,
        note: json['note'] as String?,
      );
}

class CartConfirmResult {
  final String? recommendationId;
  final CartSummary? foodCart;
  final InstamartPreview? instamartCartPreview;
  final bool checkoutBlocked;
  final String? checkoutNote;

  CartConfirmResult({
    this.recommendationId,
    this.foodCart,
    this.instamartCartPreview,
    required this.checkoutBlocked,
    this.checkoutNote,
  });

  factory CartConfirmResult.fromJson(Map<String, dynamic> json) => CartConfirmResult(
        recommendationId: json['recommendationId'] as String?,
        foodCart: json['foodCart'] != null ? CartSummary.fromJson(json['foodCart'] as Map<String, dynamic>) : null,
        instamartCartPreview: json['instamartCartPreview'] != null
            ? InstamartPreview.fromJson(json['instamartCartPreview'] as Map<String, dynamic>)
            : null,
        checkoutBlocked: json['checkoutBlocked'] == true,
        checkoutNote: json['checkoutNote'] as String?,
      );
}

class PlannerChatResponse {
  final String status;
  final dynamic state;
  final String reply;
  final List<String> quickReplies;
  final RecommendationRun? recommendation;

  PlannerChatResponse({
    required this.status,
    required this.state,
    required this.reply,
    this.quickReplies = const [],
    this.recommendation,
  });

  factory PlannerChatResponse.fromJson(Map<String, dynamic> json) => PlannerChatResponse(
        status: json['status'] as String? ?? '',
        state: json['state'],
        reply: json['reply'] as String? ?? '',
        quickReplies: (json['quickReplies'] as List<dynamic>? ?? []).map((e) => e.toString()).toList(),
        recommendation:
            json['recommendation'] != null ? RecommendationRun.fromJson(json['recommendation'] as Map<String, dynamic>) : null,
      );
}
