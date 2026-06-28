import { stepStates } from './import-pipeline';

describe('stepStates', () => {
  it('marks every step done when the import completed', () => {
    expect(stepStates({ status: 'completed', stage: 'completed' })).toEqual([
      'done', 'done', 'done', 'done',
    ]);
  });

  it('marks the current step while extracting', () => {
    expect(stepStates({ status: 'extracting', stage: 'extracting' })).toEqual([
      'done', 'current', 'idle', 'idle',
    ]);
  });

  it('treats queued as still on the upload step', () => {
    expect(stepStates({ status: 'uploaded', stage: 'queued' })).toEqual([
      'current', 'idle', 'idle', 'idle',
    ]);
  });

  it('marks convert as current while converting', () => {
    expect(stepStates({ status: 'converting', stage: 'converting' })).toEqual([
      'done', 'done', 'done', 'current',
    ]);
  });

  it('flags the failing step at extraction when nothing was extracted', () => {
    expect(stepStates({ status: 'failed', stage: 'failed', nodeCount: 0 })).toEqual([
      'done', 'error', 'idle', 'idle',
    ]);
  });

  it('flags the failing step at convert when extraction had already succeeded', () => {
    expect(
      stepStates({ status: 'failed', stage: 'failed', nodeCount: 5, conversionJobId: 'job-1' }),
    ).toEqual(['done', 'done', 'done', 'error']);
  });
});
