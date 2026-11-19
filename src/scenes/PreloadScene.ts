import Phaser from 'phaser';
import { generateTexturePack } from '../render/textures';
import { PROP_SIZES } from '../render/assetKeys';

/**
 * Preload: procedurally generates the complete pixel-art texture pack
 * (tiles, buildings parts, props, figures, particles, UI) into Phaser's texture
 * cache. There are no network requests and no external art assets.
 */
export class PreloadScene extends Phaser.Scene {
  constructor() {
    super('PreloadScene');
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#14111a');
    const { width, height } = this.scale;
    this.add
      .text(width / 2, height / 2 - 26, "A Cigarette's Life", {
        fontFamily: '"Courier New", monospace',
        fontSize: '22px',
        color: '#f2e4c8',
        resolution: 2,
      })
      .setOrigin(0.5);
    const status = this.add
      .text(width / 2, height / 2 + 8, 'drawing the world...', {
        fontFamily: '"Courier New", monospace',
        fontSize: '11px',
        color: '#a89a86',
        resolution: 2,
      })
      .setOrigin(0.5);
    const barBg = this.add.rectangle(width / 2, height / 2 + 40, 320, 8, 0x2a2530).setOrigin(0.5);
    const bar = this.add.rectangle(width / 2 - 160, height / 2 + 40, 0, 8, 0xe8dcc8).setOrigin(0, 0.5);
    void barBg;
    this.time.delayedCall(30, () => {
      try {
        generateTexturePack(this);
        bar.width = 320;
        const missing = Object.keys(PROP_SIZES).filter((key) => !this.textures.exists(key));
        if (missing.length > 0) {
          this.add
            .text(width / 2, height / 2 + 68, missing.length + ' prop textures missing (using fallbacks)', {
              fontFamily: '"Courier New", monospace',
              fontSize: '9px',
              color: '#c88a6a',
              resolution: 2,
            })
            .setOrigin(0.5);
        }
        status.setText('ready.');
        this.time.delayedCall(60, () => this.scene.start('MainMenuScene'));
      } catch (error) {
        status.setColor('#e8a0a0').setText('texture generation failed: ' + (error instanceof Error ? error.message : String(error)));
        this.time.delayedCall(2200, () => this.scene.start('MainMenuScene'));
      }
    });
  }
}
