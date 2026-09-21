import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:moodish/core/api_client.dart';

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
}
