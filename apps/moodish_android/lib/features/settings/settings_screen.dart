import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../app_state.dart';
import '../../core/api_client.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
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
