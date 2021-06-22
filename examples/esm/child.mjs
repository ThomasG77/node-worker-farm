import { threadId } from 'worker_threads';

export default function(i) {
  return `${i} BAR (${threadId})`;
}
