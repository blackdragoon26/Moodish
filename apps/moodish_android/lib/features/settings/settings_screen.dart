import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../app_state.dart';
import '../../core/api_client.dart';
import '../../core/google_auth_session.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  Map<String, dynamic>? _connection;
  List<dynamic> _addresses = [];
  bool _connecting = false;
  @override
  void initState() { super.initState(); WidgetsBinding.instance.addPostFrameCallback((_) => _loadSwiggy()); }
  Future<void> _loadSwiggy() async {
    final state = context.read<AppState>();
    if (state.health?.swiggyMode != 'live') return;
    try {
      final connection = await state.api.swiggyRequest('/api/swiggy/connection');
      final addresses = connection['connected'] == true ? (await state.api.swiggyRequest('/api/swiggy/addresses'))['addresses'] as List : <dynamic>[];
      if (mounted) setState(() { _connection = connection; _addresses = addresses; });
    } catch (error) { if (mounted) setState(() => _statusMessage = error.toString()); }
  }
  Future<void> _connectSwiggy() async {
    setState(() => _connecting = true);
    try {
      final state = context.read<AppState>();
      final token = await GoogleAuthSession().connectSwiggy(state.api);
      await state.api.setSessionToken(token);
      if (mounted) await _loadSwiggy();
    } catch (error) { if (mounted) setState(() => _statusMessage = error.toString()); }
    finally { if (mounted) setState(() => _connecting = false); }
  }
  bool _isClearingMemory = false;
  String? _statusMessage;

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final user = state.user;
    final health = state.health;

    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        children: [
          if (user != null) ...[
            const _SectionHeader('Account'),
            ListTile(title: const Text('Name'), trailing: Text(user.name)),
            if (user.email != null) ListTile(title: const Text('Email'), trailing: Text(user.email!)),
            ListTile(title: const Text('Signed in via'), trailing: Text(user.provider)),
          ],
          if (health?.swiggyMode == 'live') ...[
            const _SectionHeader('Swiggy'),
            ListTile(title: Text(_connection?['connected'] == true ? 'Swiggy connected' : 'Connect Swiggy to discover meals'), trailing: TextButton(onPressed: _connecting ? null : _connectSwiggy, child: const Text('Connect / reconnect'))),
            ..._addresses.map((a) => ListTile(title: Text('${a['label']} · ${a['display']}'), trailing: _connection?['selectedAddressId'] == a['id'] ? const Icon(Icons.check) : null,
              onTap: () async { try { await state.api.swiggyRequest('/api/swiggy/address', body: {'addressId': a['id']}); if (mounted) await _loadSwiggy(); } catch (error) { if (mounted) setState(() => _statusMessage = error.toString()); } })),
            if (_connection?['connected'] == true) TextButton(onPressed: () async { try { await state.api.swiggyRequest('/api/swiggy/disconnect', body: {}); if (mounted) await _loadSwiggy(); } catch (error) { if (mounted) setState(() => _statusMessage = error.toString()); } }, child: const Text('Disconnect Swiggy')),
          ],
          const _SectionHeader('Appearance'),
          ListTile(
            title: const Text('Theme'),
            trailing: DropdownButton<ThemeMode>(
              value: state.themeMode,
              items: const [
                DropdownMenuItem(value: ThemeMode.system, child: Text('System')),
                DropdownMenuItem(value: ThemeMode.light, child: Text('Light')),
                DropdownMenuItem(value: ThemeMode.dark, child: Text('Dark')),
              ],
              onChanged: (mode) {
                if (mode != null) state.setTheme(mode);
              },
            ),
          ),
          if (health != null) ...[
            const _SectionHeader('Connection'),
            ListTile(title: const Text('Data mode'), trailing: Text(health.swiggyMode == 'live' ? 'Live Swiggy' : 'Demo data')),
            ListTile(title: const Text('AI provider'), trailing: Text(health.aiProvider ?? 'mock')),
            const Padding(
              padding: EdgeInsets.symmetric(horizontal: 16),
              child: Text('Powered by Swiggy', style: TextStyle(fontSize: 12, color: Colors.grey)),
            ),
          ],
          const _SectionHeader('Privacy'),
          ListTile(
            title: Text('Delete my taste memory', style: TextStyle(color: Theme.of(context).colorScheme.primary)),
            onTap: _isClearingMemory ? null : _deleteTasteMemory,
          ),
          if (_statusMessage != null)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Text(_statusMessage!, style: Theme.of(context).textTheme.bodySmall),
            ),
          const SizedBox(height: 12),
          ListTile(
            title: Text('Log out', style: TextStyle(color: Theme.of(context).colorScheme.error)),
            onTap: () => context.read<AppState>().logout(),
          ),
        ],
      ),
    );
  }

  Future<void> _deleteTasteMemory() async {
    final userId = context.read<AppState>().user?.id;
    if (userId == null) return;
    setState(() => _isClearingMemory = true);
    try {
      await context.read<AppState>().api.deleteTasteMemory(userIdHash: userId);
      setState(() => _statusMessage = 'Taste memory cleared.');
    } on ApiException catch (error) {
      setState(() => _statusMessage = error.message);
    } finally {
      if (mounted) setState(() => _isClearingMemory = false);
    }
  }
}

class _SectionHeader extends StatelessWidget {
  final String title;
  const _SectionHeader(this.title);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 20, 16, 6),
      child: Text(title.toUpperCase(),
          style: Theme.of(context)
              .textTheme
              .labelSmall
              ?.copyWith(color: Theme.of(context).colorScheme.primary, fontWeight: FontWeight.w700)),
    );
  }
}
