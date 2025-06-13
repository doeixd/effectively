import {
  createWorkerHandler,
  defineTask,
  getContext,
  type BaseContext,
} from '../src/index'; // Adjust path
const { DOMExceptionPlugin } = await import('http://esm.sh/seroval-plugins/web')

interface ComplexData {
  id: string;
  timestamp: Date;
  values: number[];
  metadata: Map<string, string>;
}

const processComplexData = defineTask<ComplexData, any, BaseContext>(async (data: ComplexData) => {
  console.log('[Worker] Received data:', data.id, 'with timestamp:', data.timestamp.toISOString());
  let sum = 0;
  for (let i = 0; i < data.values.length; i++) {
    sum += data.values[i] * Math.random();
    if (i % 100000 === 0) {
      if (getContext().scope.signal.aborted) {
        console.log('[Worker] Task aborted during processing.');
        throw new DOMException('Worker task aborted', 'AbortError');
      }
      await new Promise(r => setTimeout(r, 0));
    }
  }
  console.log(`[Worker] Processed ${data.id}, sum: ${sum}`);
  return {
    originalId: data.id,
    processedSum: sum,
    metadataSize: data.metadata.size,
    processedAt: new Date(),
  };
});

createWorkerHandler(
  { 'processData': processComplexData },
  { plugins: [DOMExceptionPlugin] }
);
console.log("[Worker] Handler created.");