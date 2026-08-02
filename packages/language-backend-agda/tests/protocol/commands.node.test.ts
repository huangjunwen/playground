import { describe, expect, it } from 'vitest';
import { CommandBuilder, type IOTCMCommand } from '../../src/protocol/commands';
import {
  HIGHLIGHTING_INTERACTIVE,
  HIGHLIGHTING_NON_INTERACTIVE,
  HIGHLIGHTING_NONE,
} from '../../src/protocol/const';

const b = (path = '/Main.agda') => new CommandBuilder(path);

describe('IOTCM command builders', () => {
  // ---- existing commands ----

  it('load produces Cmd_load with file path', () => {
    expect(b().load().raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_load "/Main.agda" [])',
    );
  });

  it('metas produces Cmd_metas AsIs', () => {
    expect(b().metas().raw).toBe('IOTCM "/Main.agda" NonInteractive Direct (Cmd_metas AsIs)');
  });

  it('give produces Cmd_give WithoutForce <id> noRange <content>', () => {
    expect(b().give(0, 'true').raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_give WithoutForce 0 noRange "true")',
    );
  });

  it('give with force uses WithForce', () => {
    expect(b().give(0, 'true', { force: true }).raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_give WithForce 0 noRange "true")',
    );
  });

  it('give with a per-call range serializes intervalsToRange', () => {
    const pos = { pos: 1, line: 2, col: 3 };
    const range = [{ start: pos, end: pos }];
    expect(b().give(0, 'x', { range }).raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_give WithoutForce 0 ' +
        'intervalsToRange Nothing [Interval () (Pn () 1 2 3) (Pn () 1 2 3)] "x")',
    );
  });

  it('case produces Cmd_make_case <id> noRange <content>', () => {
    expect(b().case(1, 'x').raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_make_case 1 noRange "x")',
    );
  });

  it('case with a per-call range serializes intervalsToRange', () => {
    const pos = { pos: 4, line: 5, col: 6 };
    const range = [{ start: pos, end: pos }];
    expect(b().case(1, 'x', { range }).raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_make_case 1 ' +
        'intervalsToRange Nothing [Interval () (Pn () 4 5 6) (Pn () 4 5 6)] "x")',
    );
  });

  it('compute produces Cmd_compute DefaultCompute with no goal id', () => {
    expect(b().compute().raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_compute DefaultCompute)',
    );
  });

  it('compute with goalId and expr', () => {
    expect(b().compute(0, '2 + 2').raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_compute DefaultCompute 0 noRange "2 + 2")',
    );
  });

  it('compute with computeMode', () => {
    expect(b().compute(0, 'x', { computeMode: 'NormalisedCompute' }).raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_compute NormalisedCompute 0 noRange "x")',
    );
  });

  // ---- new commands ----

  it('abort produces Cmd_abort', () => {
    expect(b().abort().raw).toBe('IOTCM "/Main.agda" NonInteractive Direct (Cmd_abort)');
  });

  it('autoOne default', () => {
    expect(b().autoOne(0).raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_autoOne AsIs 0 noRange "")',
    );
  });

  it('autoOne with rewriteMode (via builder option)', () => {
    expect(new CommandBuilder('/Main.agda', { rewriteMode: 'Normalised' }).autoOne(1).raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_autoOne Normalised 1 noRange "")',
    );
  });

  it('autoAll default', () => {
    expect(b().autoAll().raw).toBe('IOTCM "/Main.agda" NonInteractive Direct (Cmd_autoAll AsIs)');
  });

  it('solveAll default (all goals, no goalId)', () => {
    expect(b().solveAll().raw).toBe('IOTCM "/Main.agda" NonInteractive Direct (Cmd_solveAll AsIs)');
  });

  it('solveOne default', () => {
    expect(b().solveOne(0).raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_solveOne AsIs 0 noRange "")',
    );
  });

  it('goalType default', () => {
    expect(b().goalType(0).raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_goal_type AsIs 0 noRange "")',
    );
  });

  it('goalTypeContext default', () => {
    expect(b().goalTypeContext(0).raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_goal_type_context AsIs 0 noRange "")',
    );
  });

  it('infer default', () => {
    expect(b().infer(0).raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_infer AsIs 0 noRange "")',
    );
  });

  // ---- escaping ----

  it('escapes special characters in content via JSON.stringify', () => {
    const raw = b().give(2, 'a"b').raw;
    expect(raw).toContain('Cmd_give WithoutForce 2 noRange "a\\"b"');
  });

  it('escapes special characters in file paths', () => {
    const raw = b('/path with space.agda').load().raw;
    expect(raw).toContain('"/path with space.agda"');
  });

  // ---- module loading ----

  it('loadNoMetas produces Cmd_load_no_metas', () => {
    expect(b().loadNoMetas().raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_load_no_metas "/Main.agda")',
    );
  });

  it('loadHighlightingInfo produces Cmd_load_highlighting_info', () => {
    expect(b().loadHighlightingInfo().raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_load_highlighting_info "/Main.agda")',
    );
  });

  // ---- toplevel queries ----

  it('constraints produces Cmd_constraints', () => {
    expect(b().constraints().raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_constraints)',
    );
  });

  it('showModuleContentsToplevel default', () => {
    expect(b().showModuleContentsToplevel('Nat').raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_show_module_contents_toplevel AsIs "Nat")',
    );
  });

  it('searchAboutToplevel default', () => {
    expect(b().searchAboutToplevel('+').raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_search_about_toplevel AsIs "+")',
    );
  });

  it('whyInScopeToplevel produces Cmd_why_in_scope_toplevel', () => {
    expect(b().whyInScopeToplevel('id').raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_why_in_scope_toplevel "id")',
    );
  });

  it('showVersion produces Cmd_show_version', () => {
    expect(b().showVersion().raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_show_version)',
    );
  });

  // ---- goal inspection ----

  it('context default', () => {
    expect(b().context(0).raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_context AsIs 0 noRange "")',
    );
  });

  it('showModuleContents default', () => {
    expect(b().showModuleContents(0).raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_show_module_contents AsIs 0 noRange "")',
    );
  });

  it('whyInScope default', () => {
    expect(b().whyInScope(0, { expr: 'id' }).raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_why_in_scope 0 noRange "id")',
    );
  });

  it('goalTypeContextInfer default', () => {
    expect(b().goalTypeContextInfer(0).raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_goal_type_context_infer AsIs 0 noRange "")',
    );
  });

  it('goalTypeContextCheck default', () => {
    expect(b().goalTypeContextCheck(0).raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_goal_type_context_check AsIs 0 noRange "")',
    );
  });

  // ---- goal solving ----

  it('refine default', () => {
    expect(b().refine(0, { expr: 'x' }).raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_refine 0 noRange "x")',
    );
  });

  it('intro default (pmLambda=false)', () => {
    expect(b().intro(0).raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_intro False 0 noRange "")',
    );
  });

  it('intro with pmLambda=true', () => {
    expect(b().intro(1, { pmLambda: true }).raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_intro True 1 noRange "")',
    );
  });

  it('refineOrIntro default', () => {
    expect(b().refineOrIntro(0).raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_refine_or_intro False 0 noRange "")',
    );
  });

  it('elaborateGive default', () => {
    expect(b().elaborateGive(0, { expr: 'x' }).raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_elaborate_give AsIs 0 noRange "x")',
    );
  });

  it('helperFunction default', () => {
    expect(b().helperFunction(0, { expr: 'x' }).raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_helper_function AsIs 0 noRange "x")',
    );
  });

  // ---- highlighting ----

  it('tokenHighlighting default (Keep)', () => {
    expect(b().tokenHighlighting('/Tmp.agda').raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_tokenHighlighting "/Tmp.agda" Keep)',
    );
  });

  it('tokenHighlighting with remove=true', () => {
    expect(b().tokenHighlighting('/Tmp.agda', { remove: true }).raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_tokenHighlighting "/Tmp.agda" Remove)',
    );
  });

  it('highlight default', () => {
    expect(b().highlight(0, { expr: 'x' }).raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_highlight 0 noRange "x")',
    );
  });

  // ---- backend commands ----

  it('backendTop produces Cmd_backend_top', () => {
    expect(b().backendTop('LaTeX', 'dump').raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_backend_top LaTeX "dump")',
    );
  });

  it('backendHole default', () => {
    expect(b().backendHole(0, 'LaTeX', 'dump').raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_backend_hole 0 noRange "" LaTeX "dump")',
    );
  });

  // ---- display toggles ----

  it('showImplicitArgs True', () => {
    expect(b().showImplicitArgs(true).raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (ShowImplicitArgs True)',
    );
  });

  it('showImplicitArgs False', () => {
    expect(b().showImplicitArgs(false).raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (ShowImplicitArgs False)',
    );
  });

  it('toggleImplicitArgs', () => {
    expect(b().toggleImplicitArgs().raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (ToggleImplicitArgs)',
    );
  });

  it('showIrrelevantArgs True', () => {
    expect(b().showIrrelevantArgs(true).raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (ShowIrrelevantArgs True)',
    );
  });

  it('toggleIrrelevantArgs', () => {
    expect(b().toggleIrrelevantArgs().raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (ToggleIrrelevantArgs)',
    );
  });

  // ---- builder options: highlighting level, rewrite mode, range ----

  it('defaults the highlighting level to NonInteractive', () => {
    expect(b().load().raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_load "/Main.agda" [])',
    );
  });

  it('exported highlighting-level consts', () => {
    expect(HIGHLIGHTING_NONE).toBe('None');
    expect(HIGHLIGHTING_NON_INTERACTIVE).toBe('NonInteractive');
    expect(HIGHLIGHTING_INTERACTIVE).toBe('Interactive');
  });

  it('highlightingLevel option None suppresses highlighting level', () => {
    expect(new CommandBuilder('/Main.agda', { highlightingLevel: 'None' }).load().raw).toBe(
      'IOTCM "/Main.agda" None Direct (Cmd_load "/Main.agda" [])',
    );
  });

  it('highlightingLevel option Interactive', () => {
    expect(new CommandBuilder('/Main.agda', { highlightingLevel: 'Interactive' }).load().raw).toBe(
      'IOTCM "/Main.agda" Interactive Direct (Cmd_load "/Main.agda" [])',
    );
  });

  it('highlighting level threads through all methods', () => {
    expect(
      new CommandBuilder('/Main.agda', { highlightingLevel: 'None' }).give(0, 'true').raw,
    ).toBe('IOTCM "/Main.agda" None Direct (Cmd_give WithoutForce 0 noRange "true")');
    expect(
      new CommandBuilder('/Main.agda', { highlightingLevel: 'Interactive' }).give(0, 'true', {
        force: true,
      }).raw,
    ).toBe('IOTCM "/Main.agda" Interactive Direct (Cmd_give WithForce 0 noRange "true")');
    expect(new CommandBuilder('/Main.agda', { highlightingLevel: 'None' }).exit().raw).toBe(
      'IOTCM "/Main.agda" None Direct (Cmd_exit)',
    );
    expect(new CommandBuilder('/Main.agda', { highlightingLevel: 'Interactive' }).metas().raw).toBe(
      'IOTCM "/Main.agda" Interactive Direct (Cmd_metas AsIs)',
    );
  });

  it('rewriteMode option threads through methods that take one', () => {
    expect(new CommandBuilder('/Main.agda', { rewriteMode: 'Normalised' }).metas().raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_metas Normalised)',
    );
    expect(new CommandBuilder('/Main.agda', { rewriteMode: 'Instantiated' }).autoAll().raw).toBe(
      'IOTCM "/Main.agda" NonInteractive Direct (Cmd_autoAll Instantiated)',
    );
  });

  it('returns IOTCMCommand with a raw string', () => {
    const cmd: IOTCMCommand = b().load();
    expect(typeof cmd.raw).toBe('string');
  });
});
