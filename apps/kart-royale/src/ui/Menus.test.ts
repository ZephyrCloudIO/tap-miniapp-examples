import { describe, expect, it, rstest } from '@rstest/core';
import { Race } from '../game/Race';
import { RaceState, type Ctx } from '../types';
import { inMenu } from '../net/MultiplayerSession';
import { Menus } from './Menus';

describe('network menu lifecycle', () => {
  it('removes solo restart and replay actions while the server owns the race', () => {
    const button = () => ({
      hidden: false,
      classList: { toggle: rstest.fn() },
    }) as unknown as HTMLDivElement;
    const resume = button();
    const controls = button();
    const restart = button();
    const quit = button();
    const again = button();
    const title = button();
    const menus = Object.create(Menus.prototype) as unknown as {
      buttons: { pause: HTMLDivElement[]; results: HTMLDivElement[] };
      pauseRestart: HTMLDivElement;
      resultsAgain: HTMLDivElement;
      networkActionsHidden: boolean | null;
      screen: 'results';
      btnIndex: number;
      syncNetworkActions(networkMode: boolean): void;
      activeButtons(screen: 'pause' | 'results'): HTMLDivElement[];
    };
    menus.buttons = {
      pause: [resume, controls, restart, quit],
      results: [again, title],
    };
    menus.pauseRestart = restart;
    menus.resultsAgain = again;
    menus.networkActionsHidden = null;
    menus.screen = 'results';
    menus.btnIndex = 1;

    menus.syncNetworkActions(true);

    expect(restart.hidden).toBe(true);
    expect(again.hidden).toBe(true);
    expect(menus.activeButtons('pause')).toEqual([resume, controls, quit]);
    expect(menus.activeButtons('results')).toEqual([title]);
    expect(menus.btnIndex).toBe(0);

    menus.syncNetworkActions(false);

    expect(restart.hidden).toBe(false);
    expect(again.hidden).toBe(false);
    expect(menus.activeButtons('pause')).toEqual([resume, controls, restart, quit]);
    expect(menus.activeButtons('results')).toEqual([again, title]);
  });

  it('routes return-to-title through the race lifecycle seam', () => {
    const returnToMenu = rstest.fn();
    const menus = Object.create(Menus.prototype) as unknown as {
      ctx: { race: { returnToMenu(): void } };
      localPause: boolean;
      forced: string | null;
      selecting: boolean;
      returnToTitle(): void;
    };
    menus.ctx = { race: { returnToMenu } };
    menus.localPause = true;
    menus.forced = 'results';
    menus.selecting = true;

    menus.returnToTitle();

    expect(returnToMenu).toHaveBeenCalledOnce();
    expect(menus.localPause).toBe(false);
    expect(menus.forced).toBeNull();
    expect(menus.selecting).toBe(false);
  });

  it('publishes RaceState.Menu as the authoritative return-to-title signal', () => {
    const race = new Race();
    race.state = RaceState.Countdown;
    const leaveNetwork = rstest.fn();
    Reflect.get(race, 'setNetworkLeaveHandler')?.call(race, leaveNetwork);
    race.net = {} as Race['net'];

    const returnToMenu = Reflect.get(race, 'returnToMenu');
    expect(typeof returnToMenu).toBe('function');
    returnToMenu.call(race);

    expect(leaveNetwork).toHaveBeenCalledOnce();
    expect(inMenu({ race } as unknown as Ctx)).toBe(true);
  });
});
