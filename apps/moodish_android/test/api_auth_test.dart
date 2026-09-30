import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'dart:convert';
import 'package:moodish/core/api_client.dart';
import 'package:moodish/core/session_store.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('group cart request carries group bearer and personal session separately', () async {
    FlutterSecureStorage.setMockInitialValues({});
    final seen = <String>[];
    final api = ApiClient(client: MockClient((request) async {
      expect(request.headers['authorization'], 'Bearer test-group-token');
      expect(request.headers['cookie'], 'moodish_session=test-personal-token');
      seen.add(request.url.path);
      return http.Response('{}', 200, headers: {'content-type': 'application/json'});
    }));
    await api.setSessionToken('test-personal-token');
    for (final action in ['prepare-cart', 'confirm-cart']) {
      await api.swiggyRequest('/api/group-sessions/test-group/$action',
          body: {}, bearerToken: 'test-group-token');
    }
    expect(seen, hasLength(2));
  });

  test('the personal session survives an app restart in secure storage only', () async {
    FlutterSecureStorage.setMockInitialValues({});
    SharedPreferences.setMockInitialValues({});
    await ApiClient(client: MockClient((_) async => http.Response('{}', 200))).setSessionToken('persisted-token');
    String? cookie;
    final restarted = ApiClient(client: MockClient((request) async {
      cookie = request.headers['cookie'];
      return http.Response('{"config":{},"health":{}}', 200, headers: {'content-type': 'application/json'});
    }));
    await restarted.restoreSession();
    await restarted.swiggyRequest('/api/swiggy/connection');
    expect(cookie, 'moodish_session=persisted-token');
    expect((await SharedPreferences.getInstance()).getKeys(), isEmpty);
  });

  test('a legacy plain-preferences session is moved into secure storage', () async {
    FlutterSecureStorage.setMockInitialValues({});
    SharedPreferences.setMockInitialValues({'moodish.session.cookie': 'moodish_session=legacy'});
    final api = ApiClient(client: MockClient((_) async => http.Response('{}', 200)));
    await api.restoreSession();
    expect(await const FlutterSecureStorage().read(key: 'moodish.session.cookie'), 'moodish_session=legacy');
    expect((await SharedPreferences.getInstance()).containsKey('moodish.session.cookie'), isFalse);
  });

  test('a server logout clears the stored session', () async {
    FlutterSecureStorage.setMockInitialValues({});
    final api = ApiClient(client: MockClient((_) async => http.Response('{}', 200, headers: {'set-cookie': 'moodish_session=; Path=/; Max-Age=0'})));
    await api.setSessionToken('to-clear');
    await api.logout();
    expect(await const FlutterSecureStorage().read(key: 'moodish.session.cookie'), isNull);
  });

  test('a participant keeps its private token and sends it on later answers and votes', () async {
    FlutterSecureStorage.setMockInitialValues({});
    SharedPreferences.setMockInitialValues({});
    final sent = <Map<String, dynamic>>[];
    var first = true;
    final api = ApiClient(client: MockClient((request) async {
      sent.add(jsonDecode(request.body) as Map<String, dynamic>);
      final body = {'sessionId': 'g1', 'state': 'collecting', 'headcount': 2, if (first) 'participantToken': 'issued-token'};
      first = false;
      return http.Response(jsonEncode(body), 200, headers: {'content-type': 'application/json'});
    }));
    await api.submitPreferences(sessionId: 'g1', participantId: 'p1', dietMode: 'both', mood: 'biryani', invitePasscode: 'CODE');
    await api.submitPreferences(sessionId: 'g1', participantId: 'p1', dietMode: 'both', mood: 'spicy', invitePasscode: 'CODE');
    await api.voteGroupSession(sessionId: 'g1', participantId: 'p1', optionId: 'o1', invitePasscode: 'CODE');
    expect(sent[0].containsKey('participantToken'), isFalse);
    expect(sent[1]['participantToken'], 'issued-token');
    expect(sent[2]['participantToken'], 'issued-token');
    expect(await SessionStore().participantToken('g1', 'p1'), 'issued-token');
  });
}
