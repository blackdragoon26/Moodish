class AuthConfig {
  final bool google;
  final bool swiggy;
  final String swiggyAccessUrl;
  final bool demo;

  AuthConfig({required this.google, required this.swiggy, required this.swiggyAccessUrl, required this.demo});

  factory AuthConfig.fromJson(Map<String, dynamic> json) => AuthConfig(
        google: json['google'] == true,
        swiggy: json['swiggy'] == true,
        swiggyAccessUrl: json['swiggyAccessUrl'] as String? ?? 'https://mcp.swiggy.com/builders/access/',
        demo: json['demo'] == true,
      );
}

class MoodishUser {
  final String id;
  final String name;
  final String? email;
  final String? picture;
  final String provider;

  MoodishUser({required this.id, required this.name, this.email, this.picture, required this.provider});

  factory MoodishUser.fromJson(Map<String, dynamic> json) => MoodishUser(
        id: json['id'] as String,
        name: json['name'] as String? ?? 'Moodish member',
        email: json['email'] as String?,
        picture: json['picture'] as String?,
        provider: json['provider'] as String? ?? 'unknown',
      );
}

class HealthStatus {
  final bool ok;
  final String? service;
  final String? swiggyMode;
  final String? aiProvider;

  HealthStatus({required this.ok, this.service, this.swiggyMode, this.aiProvider});

  factory HealthStatus.fromJson(Map<String, dynamic> json) => HealthStatus(
        ok: json['ok'] == true,
        service: json['service'] as String?,
        swiggyMode: json['swiggyMode'] as String?,
        aiProvider: json['aiProvider'] as String?,
      );
}

/// Meal-memory items only ever carry {name, quantity} — not the full
/// MealItem shape used elsewhere (see recommender.mjs) — so this has its
/// own lightweight item type rather than reusing MealItem.
class MealMemoryItem {
  final String name;
  final int? quantity;

  MealMemoryItem({required this.name, this.quantity});

  factory MealMemoryItem.fromJson(Map<String, dynamic> json) =>
      MealMemoryItem(name: json['name'] as String? ?? '', quantity: json['quantity'] as int?);
}

class MealMemoryAddOn {
  final String name;
  final num? price;

  MealMemoryAddOn({required this.name, this.price});

  factory MealMemoryAddOn.fromJson(Map<String, dynamic> json) =>
      MealMemoryAddOn(name: json['name'] as String? ?? '', price: json['price'] as num?);
}

class MealMemoryEntry {
  final String? recommendationId;
  final String? restaurantName;
  final String? cuisine;
  final List<MealMemoryItem> items;
  final List<MealMemoryAddOn> addOns;
  final num? foodTotal;
  final num? instamartTotal;
  final String? confirmedAt;

  MealMemoryEntry({
    this.recommendationId,
    this.restaurantName,
    this.cuisine,
    this.items = const [],
    this.addOns = const [],
    this.foodTotal,
    this.instamartTotal,
    this.confirmedAt,
  });

  num? get total {
    if (foodTotal == null && instamartTotal == null) return null;
    return (foodTotal ?? 0) + (instamartTotal ?? 0);
  }

  factory MealMemoryEntry.fromJson(Map<String, dynamic> json) => MealMemoryEntry(
        recommendationId: json['recommendationId'] as String?,
        restaurantName: json['restaurantName'] as String?,
        cuisine: json['cuisine'] as String?,
        items: (json['items'] as List<dynamic>? ?? [])
            .map((e) => MealMemoryItem.fromJson(e as Map<String, dynamic>))
            .toList(),
        addOns: (json['addOns'] as List<dynamic>? ?? [])
            .map((e) => MealMemoryAddOn.fromJson(e as Map<String, dynamic>))
            .toList(),
        foodTotal: json['foodTotal'] as num?,
        instamartTotal: json['instamartTotal'] as num?,
        confirmedAt: json['confirmedAt'] as String?,
      );
}

class BootstrapResponse {
  final AuthConfig config;
  final MoodishUser? user;
  final List<MealMemoryEntry> mealMemory;
  final HealthStatus health;

  BootstrapResponse({required this.config, this.user, required this.mealMemory, required this.health});

  factory BootstrapResponse.fromJson(Map<String, dynamic> json) => BootstrapResponse(
        config: AuthConfig.fromJson(json['config'] as Map<String, dynamic>),
        user: json['user'] != null ? MoodishUser.fromJson(json['user'] as Map<String, dynamic>) : null,
        mealMemory: (json['mealMemory'] as List<dynamic>? ?? [])
            .map((e) => MealMemoryEntry.fromJson(e as Map<String, dynamic>))
            .toList(),
        health: HealthStatus.fromJson(json['health'] as Map<String, dynamic>),
      );
}
