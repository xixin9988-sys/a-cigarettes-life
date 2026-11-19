import Phaser from 'phaser';
import { BootScene } from './BootScene';
import { PreloadScene } from './PreloadScene';
import { MainMenuScene } from './MainMenuScene';
import { TownScene } from './TownScene';
import { CityScene } from './CityScene';
import { InteriorScene } from './InteriorScene';
import { LifeEndScene } from './LifeEndScene';

/**
 * Phaser game configuration.
 *
 * - AUTO renderer (WebGL when available, Canvas otherwise)
 * - canvas parent #game-root, DOM UI lives above it in #ui-root
 * - RESIZE scale mode so the diorama always fills the window
 * - pixelArt + roundPixels for crisp procedural pixel art
 * - no audio subsystem (the audio manager is a separate DOM module)
 * - all seven gameplay scenes, boot first
 */
export function createPhaserConfig(): Phaser.Types.Core.GameConfig {
  return {
    type: Phaser.AUTO,
    parent: 'game-root',
    backgroundColor: '#14111a',
    pixelArt: true,
    roundPixels: true,
    banner: false,
    disableContextMenu: true,
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    render: {
      antialias: false,
      pixelArt: true,
      roundPixels: true,
      powerPreference: 'high-performance',
    },
    input: {
      activePointers: 1,
    },
    audio: {
      noAudio: true,
    },
    scene: [BootScene, PreloadScene, MainMenuScene, TownScene, CityScene, InteriorScene, LifeEndScene],
  };
}
