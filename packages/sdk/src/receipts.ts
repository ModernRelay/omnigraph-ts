import type { BranchMerge, BranchMergeInput, Change, Commit } from './types';

function mergeReceipt(
  outcome: string,
  commit: Commit | null | undefined,
  target: string,
  actor?: string | null,
): boolean {
  if (outcome === 'already_up_to_date') return commit === null;
  return (
    (outcome === 'fast_forward' || outcome === 'merged') &&
    !!commit &&
    typeof commit.graphCommitId === 'string' &&
    commit.graphCommitId.length > 0 &&
    // Detached manifest versions exceed JS's safe-integer range; commit ids,
    // not rounded physical versions, identify proposals and their publication.
    Number.isInteger(commit.graphManifestVersion) &&
    commit.graphManifestVersion > 0 &&
    (commit.graphBranch ?? 'main') === target &&
    typeof commit.parentCommitId === 'string' &&
    commit.parentCommitId.length > 0 &&
    typeof commit.mergedParentCommitId === 'string' &&
    commit.mergedParentCommitId.length > 0 &&
    (commit.actorId ?? null) === (actor ?? null)
  );
}

export function validMerge(
  output: BranchMerge,
  input: BranchMergeInput,
): boolean {
  if (
    !output ||
    output.source !== input.source ||
    output.target !== (input.target ?? 'main') ||
    !(input.dryRun
      ? output.dryRun === true &&
        output.commit === null &&
        ['already_up_to_date', 'fast_forward', 'merged'].includes(
          output.outcome,
        )
      : output.dryRun !== true &&
        mergeReceipt(
          output.outcome,
          output.commit,
          output.target,
          output.actorId,
        ) &&
        (output.commit == null ||
          (input.asCommit
            ? output.commit.kind === 'unpublished' &&
              output.commit.published === false
            : output.commit.kind === 'published' &&
              output.commit.published !== false)))
  )
    return false;
  if (!input.deleteBranch)
    return (
      output.branchDeleted == null && output.branchDeleteErrorDetails == null
    );
  return (
    (output.branchDeleted === true &&
      output.branchDeleteErrorDetails == null) ||
    (output.branchDeleted === false &&
      typeof output.branchDeleteErrorDetails?.error === 'string' &&
      output.branchDeleteErrorDetails.error.length > 0)
  );
}

export function validMutationReceipt(output: Change): boolean {
  return (
    output?.outcome?.kind !== 'merged' ||
    mergeReceipt(
      output.outcome.merge,
      output.commit,
      output.outcome.target,
      output.actorId,
    )
  );
}
