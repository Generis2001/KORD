// Match streamed progress and final reports to the directive that requested them.
(() => {
  const matchesGoal = (mandate, text) => {
    const actualGoal = mandate?.requestedGoal || mandate?.goal;
    const expectedGoal = mandate?.requestedGoal ? text.trim() : text.replace(/;\s*(?:research\s+fee|escrow|pay)\s+[\s\S]*$/i, '').trim();
    return !actualGoal || actualGoal.trim() === expectedGoal;
  };
  const check = (data, request) => {
    const mandate = data.mandateResult?.mandate;
    if ((data.requestId && data.requestId !== request.requestId) || (mandate && mandate.id !== request.requestId)) throw new Error('This response belongs to another directive. It was not attached to this message.');
    if (!matchesGoal(mandate, request.text)) throw new Error('The returned report does not match your directive. It was not attached to this message.');
    return data;
  };
  async function read(response, request, onProgress) {
    if (!response.headers.get('content-type')?.includes('application/x-ndjson')) {
      const data = await response.json();
      return check(data, request);
    }
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let buffer = '', result;
    const event = line => {
      if (!line.trim()) return;
      const entry = JSON.parse(line);
      if (entry.requestId !== request.requestId) throw new Error('Received progress for another directive.');
      if (entry.type === 'progress') onProgress(entry.step);
      else if (entry.type === 'result') result = check(entry.data, request);
    };
    try {
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        if (buffer.length > 1_000_000) throw new Error('The response exceeds the report size limit.');
        let end;
        while ((end = buffer.indexOf('\n')) >= 0) { event(buffer.slice(0, end)); buffer = buffer.slice(end + 1); }
        if (done) { event(buffer); break; }
      }
    } finally { reader.releaseLock(); }
    if (!result) throw new Error('The response was interrupted before the final report. Check wallet receipts before retrying a paid mandate.');
    return result;
  }
  window.MandateChat = { check, read, matchesGoal };
})();
