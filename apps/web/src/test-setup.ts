// happy-dom 21 rejects Animation.finished on cancel but misses the spec's
// PromiseIsHandled step. Browsers handle that base promise internally; only
// an unhandled derived promise (e.g. finished.then(...)) should report an error.
// https://w3c.github.io/web-animations/#canceling-an-animation
// Keep real animations and cancellation, including rejected finished promises.
if (typeof Animation !== 'undefined') {
  const cancelAnimation = Animation.prototype.cancel;
  Animation.prototype.cancel = function (): void {
    void this.finished.catch((error: unknown) => {
      if (!(error instanceof DOMException) || error.name !== 'AbortError') throw error;
    });
    cancelAnimation.call(this);
  };
}
