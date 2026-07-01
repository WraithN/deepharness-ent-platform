import {
  ExternalStoreRuntimeCore,
  ExternalStoreThreadRuntimeCore,
} from '@assistant-ui/core/internal';

console.log('[Patch] assistant-ui patch loaded, ExternalStoreRuntimeCore=%o', ExternalStoreRuntimeCore);

const originalSetAdapter = ExternalStoreRuntimeCore.prototype.setAdapter;
ExternalStoreRuntimeCore.prototype.setAdapter = function (this: any, adapter: any) {
  console.log('[Patch] setAdapter called, hasMessages=%s, isRunning=%s', adapter.messages?.length, adapter.isRunning);
  originalSetAdapter.call(this, adapter);
  // ExternalStoreThreadRuntimeCore.__internal_setAdapter processes messages and
  // calls _notifySubscribers() on the thread core, but ThreadRuntimeImpl.main
  // subscribes to the thread list core, not the thread core. Without this
  // extra notification, the Zustand store (useAuiState) never learns about
  // new messages and ThreadPrimitive.Messages renders nothing.
  console.log('[Patch] calling threads._notifySubscribers()');
  this.threads._notifySubscribers();
};

const originalReset = ExternalStoreThreadRuntimeCore.prototype.reset;
ExternalStoreThreadRuntimeCore.prototype.reset = function (this: any, initialMessages?: any) {
  console.log('[Patch] reset called, initialMessages=%d', initialMessages?.length ?? 0);
  originalReset.call(this, initialMessages);
  // reset() updates the message repository but does not notify thread state
  // subscribers in some versions. Force a notification so that switching
  // sessions (loading history) re-renders ThreadPrimitive.Messages.
  if (typeof this._notifySubscribers === 'function') {
    this._notifySubscribers();
  }
};
