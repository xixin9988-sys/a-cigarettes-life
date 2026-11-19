import Phaser from 'phaser';

/** Boot: renderer hand-off and splash. Texture generation happens in PreloadScene. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#14111a');
    const { width, height } = this.scale;
    this.add
      .text(width / 2, height / 2 - 10, "A Cigarette's Life", {
        fontFamily: '"Courier New", monospace',
        fontSize: '22px',
        color: '#f2e4c8',
        resolution: 2,
      })
      .setOrigin(0.5);
    this.add
      .text(width / 2, height / 2 + 20, 'lighting the first match...', {
        fontFamily: '"Courier New", monospace',
        fontSize: '11px',
        color: '#a89a86',
        resolution: 2,
      })
      .setOrigin(0.5);
    this.time.delayedCall(120, () => this.scene.start('PreloadScene'));
  }
}
