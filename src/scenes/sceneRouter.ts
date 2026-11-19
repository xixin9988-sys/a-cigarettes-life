import Phaser from 'phaser';
import type { ISceneSession } from '../ui/UIInterfaces';
import { sceneForLocation, type WorldSceneKey } from './sceneHelpers';

/**
 * Scene routing helpers shared by the boot/menu/world/life-end scenes.
 * All transitions fade out first so the switch never flashes.
 */

export function worldSceneKeyForLocation(session: ISceneSession, locationId: string | null | undefined): WorldSceneKey {
  const id = locationId ?? session.api.getState().player.position.locationId;
  return sceneForLocation(session.content, id);
}

/** Starts the world scene matching the current player location. */
export function startWorldScene(scene: Phaser.Scene, session: ISceneSession): void {
  const target = worldSceneKeyForLocation(session, null);
  if (scene.scene.key === target) scene.scene.restart();
  else scene.scene.start(target);
}

/** Fades the camera out and switches/restarts the scene. Safe to call repeatedly. */
export function fadeToScene(scene: Phaser.Scene, key: string): void {
  const camera = scene.cameras.main;
  let handled = false;
  const go = (): void => {
    if (handled) return;
    handled = true;
    if (scene.scene.key === key) scene.scene.restart();
    else scene.scene.start(key);
  };
  camera.fadeOut(180, 10, 8, 14);
  camera.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, go);
  // Safety net if the camera effect is interrupted by a shutdown.
  scene.time.delayedCall(420, go);
}

/** Routes to the scene for the player's current location after a travel action. */
export function transitionToLocationScene(scene: Phaser.Scene, session: ISceneSession): void {
  const state = session.api.getState();
  fadeToScene(scene, worldSceneKeyForLocation(session, state.player.position.locationId));
}
