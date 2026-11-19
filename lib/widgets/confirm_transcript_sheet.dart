import 'package:flutter/material.dart';

enum TranscriptAction { send, rerecord, cancel }

class TranscriptDecision {
  const TranscriptDecision(this.action, [this.text = '']);
  final TranscriptAction action;
  final String text;
}

/// Shows the editable transcript. The user must choose Send, Re-record or Cancel.
Future<TranscriptDecision> confirmTranscript(
  BuildContext context,
  String initial,
) async {
  final result = await showModalBottomSheet<TranscriptDecision>(
    context: context,
    isScrollControlled: true,
    isDismissible: false,
    enableDrag: false,
    builder: (_) => _TranscriptSheet(initial: initial),
  );
  return result ?? const TranscriptDecision(TranscriptAction.cancel);
}

class _TranscriptSheet extends StatefulWidget {
  const _TranscriptSheet({required this.initial});
  final String initial;

  @override
  State<_TranscriptSheet> createState() => _TranscriptSheetState();
}

class _TranscriptSheetState extends State<_TranscriptSheet> {
  late final TextEditingController _controller =
      TextEditingController(text: widget.initial);

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(
        16,
        16,
        16,
        MediaQuery.of(context).viewInsets.bottom + 16,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Check your message',
            style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 4),
          const Text('Fix anything we heard wrong, then send.'),
          const SizedBox(height: 12),
          TextField(
            controller: _controller,
            autofocus: true,
            minLines: 2,
            maxLines: 6,
            textCapitalization: TextCapitalization.sentences,
            decoration: const InputDecoration(border: OutlineInputBorder()),
            onChanged: (_) => setState(() {}),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              TextButton(
                onPressed: () => Navigator.pop(
                  context,
                  const TranscriptDecision(TranscriptAction.rerecord),
                ),
                child: const Text('Re-record'),
              ),
              const Spacer(),
              TextButton(
                onPressed: () => Navigator.pop(
                  context,
                  const TranscriptDecision(TranscriptAction.cancel),
                ),
                child: const Text('Cancel'),
              ),
              const SizedBox(width: 8),
              FilledButton(
                onPressed: _controller.text.trim().isEmpty
                    ? null
                    : () => Navigator.pop(
                          context,
                          TranscriptDecision(
                            TranscriptAction.send,
                            _controller.text.trim(),
                          ),
                        ),
                child: const Text('Send'),
              ),
            ],
          ),
        ],
      ),
    );
  }
}