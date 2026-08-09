import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../app_state.dart';
import '../../core/api_client.dart';
import '../../core/models/recommendation_models.dart';
import 'cart_review_screen.dart';

class RecommendationDeckScreen extends StatefulWidget {
  final RecommendationRun recommendation;
  const RecommendationDeckScreen({super.key, required this.recommendation});

  @override
  State<RecommendationDeckScreen> createState() => _RecommendationDeckScreenState();
}

class _RecommendationDeckScreenState extends State<RecommendationDeckScreen> {
  String? _selectedOptionId;
  final Set<String> _selectedAddOnIds = {};
  bool _isConfirming = false;
  String? _errorMessage;

  RecommendationOption? get _selectedOption =>
      widget.recommendation.options.where((o) => o.optionId == _selectedOptionId).firstOrNull;

  num get _runningTotal {
    final optionTotal = _selectedOption?.estimatedTotal ?? 0;
    final addOnTotal = widget.recommendation.addOns
        .where((a) => _selectedAddOnIds.contains(a.productId))
        .fold<num>(0, (sum, a) => sum + a.price);
    return optionTotal + addOnTotal;
  }

  @override
  Widget build(BuildContext context) {
    final rec = widget.recommendation;
    return Scaffold(
      appBar: AppBar(title: const Text('Recommendations')),
      body: Column(
        children: [
          Expanded(
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                if (rec.summary != null) Text(rec.summary!, style: Theme.of(context).textTheme.bodyMedium),
                if (rec.demo?.active == true) ...[
                  const SizedBox(height: 8),
                  Text(rec.demo?.note ?? 'Demo data — no live Swiggy order will be placed.',
                      style: Theme.of(context).textTheme.bodySmall),
                ],
                const SizedBox(height: 16),
                ...rec.options.map((option) => _OptionCard(
                      option: option,
                      isSelected: option.optionId == _selectedOptionId,
                      onTap: () => setState(() => _selectedOptionId = option.optionId),
                    )),
                if (rec.addOns.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  Text('Moodish Pairings', style: Theme.of(context).textTheme.titleMedium),
                  ...rec.addOns.map((addOn) => _AddOnRow(
                        addOn: addOn,
                        isSelected: _selectedAddOnIds.contains(addOn.productId),
                        onToggle: () => setState(() {
                          if (_selectedAddOnIds.contains(addOn.productId)) {
                            _selectedAddOnIds.remove(addOn.productId);
                          } else {
                            _selectedAddOnIds.add(addOn.productId);
                          }
                        }),
                      )),
                ],
                if (_errorMessage != null) ...[
                  const SizedBox(height: 8),
                  Text(_errorMessage!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
                ],
              ],
            ),
          ),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                children: [
                  Text('₹$_runningTotal', style: Theme.of(context).textTheme.titleMedium),
                  const Spacer(),
                  FilledButton(
                    onPressed: _selectedOptionId == null || _isConfirming ? null : _confirmDialog,
                    child: _isConfirming
                        ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                        : const Text('Review cart →'),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _confirmDialog() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Confirm preview'),
        content: const Text(
            'Prepare the selected Food and Instamart cart previews? This still will not place an order.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Confirm preview')),
        ],
      ),
    );
    if (confirmed != true) return;
    await _confirmCart();
  }

  Future<void> _confirmCart() async {
    setState(() {
      _isConfirming = true;
      _errorMessage = null;
    });
    try {
      final api = context.read<AppState>().api;
      final result = await api.confirmCart(
        recommendationId: widget.recommendation.recommendationId,
        optionId: _selectedOptionId!,
        addOnProductIds: _selectedAddOnIds.toList(),
      );
      if (!mounted) return;
      await Navigator.of(context).push(MaterialPageRoute(builder: (_) => CartReviewScreen(result: result)));
      if (mounted) Navigator.of(context).pop();
    } on ApiException catch (error) {
      setState(() => _errorMessage = error.message);
    } finally {
      if (mounted) setState(() => _isConfirming = false);
    }
  }
}

class _OptionCard extends StatelessWidget {
  final RecommendationOption option;
  final bool isSelected;
  final VoidCallback onTap;

  const _OptionCard({required this.option, required this.isSelected, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      color: isSelected ? scheme.primaryContainer : null,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: isSelected ? BorderSide(color: scheme.primary, width: 2) : BorderSide.none,
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(child: Text(option.restaurantName, style: Theme.of(context).textTheme.titleMedium)),
                  Text('₹${option.estimatedTotal}', style: Theme.of(context).textTheme.titleMedium),
                ],
              ),
              if (option.cuisine != null)
                Text(option.cuisine!, style: Theme.of(context).textTheme.bodySmall),
              ...option.items.map((item) => Text('• ${item.name}', style: Theme.of(context).textTheme.bodySmall)),
              if (option.reasons.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text(option.reasons.first,
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(color: scheme.primary)),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _AddOnRow extends StatelessWidget {
  final AddOnProduct addOn;
  final bool isSelected;
  final VoidCallback onToggle;

  const _AddOnRow({required this.addOn, required this.isSelected, required this.onToggle});

  @override
  Widget build(BuildContext context) {
    return CheckboxListTile(
      value: isSelected,
      onChanged: (_) => onToggle(),
      title: Text(addOn.name),
      subtitle: addOn.pairingReason != null ? Text(addOn.pairingReason!) : null,
      secondary: Text('₹${addOn.price}'),
      controlAffinity: ListTileControlAffinity.leading,
    );
  }
}

extension _FirstOrNull<T> on Iterable<T> {
  T? get firstOrNull => isEmpty ? null : first;
}
