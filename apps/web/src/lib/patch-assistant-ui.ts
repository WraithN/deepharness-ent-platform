import { ExternalStoreRuntimeCore } from '@assistant-ui/core/internal';

console.log('[Patch] assistant-ui patch loaded, ExternalStoreRuntimeCore=%o', ExternalStoreRuntimeCore);

const originalSetAdapter = ExternalStoreRuntimeCore.prototype.setAdapter;
ExternalStoreRuntimeCore.prototype.setAdapter = function (this: any, adapter: any) {
  console.log('[Patch] setAdapter called, hasMessages=%s, isRunning=%s', adapter.messages?.length, adapter.isRunning);
  console.log('[Patch] messages:', adapter.messages?.map((m: any) => ({ id: m.id, role: m.role, partsCount: m.parts?.length })));
  originalSetAdapter.call(this, adapter);
  // ExternalStoreThreadRuntimeCore.__internal_setAdapter processes messages and
  // calls _notifySubscribers() on the thread core, but ThreadRuntimeImpl.main
  // subscribes to the thread list core, not the thread core. Without this
  // extra notification, the Zustand store (useAuiState) never learns about
  // new messages and ThreadPrimitive.Messages renders nothing.
  console.log('[Patch] calling threads._notifySubscribers()');
  this.threads._notifySubscribers();
};
