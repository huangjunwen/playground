import { describe, expect, it } from 'vitest';
import {
  cmdAbort,
  cmdAutoAll,
  cmdAutoOne,
  cmdBackendHole,
  cmdBackendTop,
  cmdCase,
  cmdCompute,
  cmdConstraints,
  cmdContext,
  cmdElaborateGive,
  cmdGive,
  cmdGoalType,
  cmdGoalTypeContext,
  cmdGoalTypeContextCheck,
  cmdGoalTypeContextInfer,
  cmdHelperFunction,
  cmdHighlight,
  cmdInfer,
  cmdIntro,
  cmdLoad,
  cmdLoadHighlightingInfo,
  cmdLoadNoMetas,
  cmdMetas,
  cmdRefine,
  cmdRefineOrIntro,
  cmdSearchAboutToplevel,
  cmdShowImplicitArgs,
  cmdShowIrrelevantArgs,
  cmdShowModuleContents,
  cmdShowModuleContentsToplevel,
  cmdShowVersion,
  cmdSolveAll,
  cmdSolveOne,
  cmdToggleImplicitArgs,
  cmdToggleIrrelevantArgs,
  cmdTokenHighlighting,
  cmdWhyInScope,
  cmdWhyInScopeToplevel,
} from '../../src/protocol/commands';

describe('IOTCM command builders', () => {
  // ---- existing commands ----

  it('cmdLoad produces Cmd_load with file path', () => {
    expect(cmdLoad('/Main.agda').raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_load "/Main.agda" [])',
    );
  });

  it('cmdMetas produces Cmd_metas AsIs', () => {
    expect(cmdMetas('/Main.agda').raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_metas AsIs)',
    );
  });

  it('cmdGive produces Cmd_give WithoutForce <id> noRange <content>', () => {
    expect(cmdGive('/Main.agda', 0, 'true').raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_give WithoutForce 0 noRange "true")',
    );
  });

  it('cmdGive with force uses WithForce', () => {
    expect(cmdGive('/Main.agda', 0, 'true', { force: true }).raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_give WithForce 0 noRange "true")',
    );
  });

  it('cmdGive with custom range', () => {
    expect(cmdGive('/Main.agda', 0, 'x', { range: 'r0-3' }).raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_give WithoutForce 0 r0-3 "x")',
    );
  });

  it('cmdCase produces Cmd_make_case <id> noRange <content>', () => {
    expect(cmdCase('/Main.agda', 1, 'x').raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_make_case 1 noRange "x")',
    );
  });

  it('cmdCase with custom range', () => {
    expect(cmdCase('/Main.agda', 1, 'x', { range: 'r1-5' }).raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_make_case 1 r1-5 "x")',
    );
  });

  it('cmdCompute produces Cmd_compute DefaultCompute with no goal id', () => {
    expect(cmdCompute('/Main.agda').raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_compute DefaultCompute)',
    );
  });

  it('cmdCompute with goalId and expr', () => {
    expect(cmdCompute('/Main.agda', 0, '2 + 2').raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_compute DefaultCompute 0 noRange "2 + 2")',
    );
  });

  it('cmdCompute with computeMode', () => {
    expect(cmdCompute('/Main.agda', 0, 'x', { computeMode: 'NormalisedCompute' }).raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_compute NormalisedCompute 0 noRange "x")',
    );
  });

  // ---- new commands ----

  it('cmdAbort produces Cmd_abort', () => {
    expect(cmdAbort('/Main.agda').raw).toBe('IOTCM "/Main.agda" NonInteractive Direct (Cmd_abort)');
  });

  it('cmdAutoOne default', () => {
    expect(cmdAutoOne('/Main.agda', 0).raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_autoOne AsIs 0 noRange "")',
    );
  });

  it('cmdAutoOne with rewriteMode', () => {
    expect(cmdAutoOne('/Main.agda', 1, { rewriteMode: 'Normalised' }).raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_autoOne Normalised 1 noRange "")',
    );
  });

  it('cmdAutoAll default', () => {
    expect(cmdAutoAll('/Main.agda').raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_autoAll AsIs)',
    );
  });

  it('cmdSolveAll default (all goals, no goalId)', () => {
    expect(cmdSolveAll('/Main.agda').raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_solveAll AsIs)',
    );
  });

  it('cmdSolveOne default', () => {
    expect(cmdSolveOne('/Main.agda', 0).raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_solveOne AsIs 0 noRange "")',
    );
  });

  it('cmdGoalType default', () => {
    expect(cmdGoalType('/Main.agda', 0).raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_goal_type AsIs 0 noRange "")',
    );
  });

  it('cmdGoalTypeContext default', () => {
    expect(cmdGoalTypeContext('/Main.agda', 0).raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_goal_type_context AsIs 0 noRange "")',
    );
  });

  it('cmdInfer default', () => {
    expect(cmdInfer('/Main.agda', 0).raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_infer AsIs 0 noRange "")',
    );
  });

  // ---- escaping ----

  it('escapes special characters in content via JSON.stringify', () => {
    const raw = cmdGive('/Main.agda', 2, 'a"b').raw;
    expect(raw).toContain('Cmd_give WithoutForce 2 noRange "a\\"b"');
  });

  it('escapes special characters in file paths', () => {
    const raw = cmdLoad('/path with space.agda').raw;
    expect(raw).toContain('"/path with space.agda"');
  });

  // ---- module loading ----

  it('cmdLoadNoMetas produces Cmd_load_no_metas', () => {
    expect(cmdLoadNoMetas('/Main.agda').raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_load_no_metas "/Main.agda")',
    );
  });

  it('cmdLoadHighlightingInfo produces Cmd_load_highlighting_info', () => {
    expect(cmdLoadHighlightingInfo('/Main.agda').raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_load_highlighting_info "/Main.agda")',
    );
  });

  // ---- toplevel queries ----

  it('cmdConstraints produces Cmd_constraints', () => {
    expect(cmdConstraints('/Main.agda').raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_constraints)',
    );
  });

  it('cmdShowModuleContentsToplevel default', () => {
    expect(cmdShowModuleContentsToplevel('/Main.agda', 'Nat').raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_show_module_contents_toplevel AsIs "Nat")',
    );
  });

  it('cmdSearchAboutToplevel default', () => {
    expect(cmdSearchAboutToplevel('/Main.agda', '+').raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_search_about_toplevel AsIs "+")',
    );
  });

  it('cmdWhyInScopeToplevel produces Cmd_why_in_scope_toplevel', () => {
    expect(cmdWhyInScopeToplevel('/Main.agda', 'id').raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_why_in_scope_toplevel "id")',
    );
  });

  it('cmdShowVersion produces Cmd_show_version', () => {
    expect(cmdShowVersion('/Main.agda').raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_show_version)',
    );
  });

  // ---- goal inspection ----

  it('cmdContext default', () => {
    expect(cmdContext('/Main.agda', 0).raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_context AsIs 0 noRange "")',
    );
  });

  it('cmdShowModuleContents default', () => {
    expect(cmdShowModuleContents('/Main.agda', 0).raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_show_module_contents AsIs 0 noRange "")',
    );
  });

  it('cmdWhyInScope default', () => {
    expect(cmdWhyInScope('/Main.agda', 0, { expr: 'id' }).raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_why_in_scope 0 noRange "id")',
    );
  });

  it('cmdGoalTypeContextInfer default', () => {
    expect(cmdGoalTypeContextInfer('/Main.agda', 0).raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_goal_type_context_infer AsIs 0 noRange "")',
    );
  });

  it('cmdGoalTypeContextCheck default', () => {
    expect(cmdGoalTypeContextCheck('/Main.agda', 0).raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_goal_type_context_check AsIs 0 noRange "")',
    );
  });

  // ---- goal solving ----

  it('cmdRefine default', () => {
    expect(cmdRefine('/Main.agda', 0, { expr: 'x' }).raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_refine 0 noRange "x")',
    );
  });

  it('cmdIntro default (pmLambda=false)', () => {
    expect(cmdIntro('/Main.agda', 0).raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_intro False 0 noRange "")',
    );
  });

  it('cmdIntro with pmLambda=true', () => {
    expect(cmdIntro('/Main.agda', 1, { pmLambda: true }).raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_intro True 1 noRange "")',
    );
  });

  it('cmdRefineOrIntro default', () => {
    expect(cmdRefineOrIntro('/Main.agda', 0).raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_refine_or_intro False 0 noRange "")',
    );
  });

  it('cmdElaborateGive default', () => {
    expect(cmdElaborateGive('/Main.agda', 0, { expr: 'x' }).raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_elaborate_give AsIs 0 noRange "x")',
    );
  });

  it('cmdHelperFunction default', () => {
    expect(cmdHelperFunction('/Main.agda', 0, { expr: 'x' }).raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_helper_function AsIs 0 noRange "x")',
    );
  });

  // ---- highlighting ----

  it('cmdTokenHighlighting default (Keep)', () => {
    expect(cmdTokenHighlighting('/Main.agda', '/Tmp.agda').raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_tokenHighlighting "/Tmp.agda" Keep)',
    );
  });

  it('cmdTokenHighlighting with remove=true', () => {
    expect(cmdTokenHighlighting('/Main.agda', '/Tmp.agda', { remove: true }).raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_tokenHighlighting "/Tmp.agda" Remove)',
    );
  });

  it('cmdHighlight default', () => {
    expect(cmdHighlight('/Main.agda', 0, { expr: 'x' }).raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_highlight 0 noRange "x")',
    );
  });

  // ---- backend commands ----

  it('cmdBackendTop produces Cmd_backend_top', () => {
    expect(cmdBackendTop('/Main.agda', 'LaTeX', 'dump').raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_backend_top LaTeX "dump")',
    );
  });

  it('cmdBackendHole default', () => {
    expect(cmdBackendHole('/Main.agda', 0, 'LaTeX', 'dump').raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_backend_hole 0 noRange "" LaTeX "dump")',
    );
  });

  // ---- display toggles ----

  it('cmdShowImplicitArgs True', () => {
    expect(cmdShowImplicitArgs('/Main.agda', true).raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (ShowImplicitArgs True)',
    );
  });

  it('cmdShowImplicitArgs False', () => {
    expect(cmdShowImplicitArgs('/Main.agda', false).raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (ShowImplicitArgs False)',
    );
  });

  it('cmdToggleImplicitArgs', () => {
    expect(cmdToggleImplicitArgs('/Main.agda').raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (ToggleImplicitArgs)',
    );
  });

  it('cmdShowIrrelevantArgs True', () => {
    expect(cmdShowIrrelevantArgs('/Main.agda', true).raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (ShowIrrelevantArgs True)',
    );
  });

  it('cmdToggleIrrelevantArgs', () => {
    expect(cmdToggleIrrelevantArgs('/Main.agda').raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (ToggleIrrelevantArgs)',
    );
  });
});
