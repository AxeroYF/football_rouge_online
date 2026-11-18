// A lost response does not mean the server failed. Always look up the same
// persisted request before retrying; never generate a new draw on recovery.
export async function requestDirectPackBatch(request, payload, { recover = false } = {}) {
  if (recover) {
    const found = await request('/packs/batch-result', { requestId:payload.requestId });
    if (!found || found.packBatchOpening?.complete) return found;
  }
  try {
    return await request('/packs/open-batch', payload);
  } catch (error) {
    if (error.status >= 400 && error.status < 500) throw error;
    const found = await request('/packs/batch-result', { requestId:payload.requestId });
    if (!found || found.packBatchOpening?.complete) return found;
    throw error;
  }
}
