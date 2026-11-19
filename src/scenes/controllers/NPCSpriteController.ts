import Phaser from 'phaser';
import type { NPCState } from '../../core/contracts';
import type { LocationPlan } from '../../render/layout';
import { resolveNpcAnchor } from '../../render/layout';
import { activityPose, figureWalkCycle, npcBreath, npcEmotionBubble, npcFacing, npcFigurePalette, npcWalkOffset, type FigurePalette, type FigurePose } from '../../render/figures';

/**
 * Renders one NPC: layered body sprites tinted from NPCState.appearance, a pose
 * family from the activity, deterministic walk/idle movement, emotion bubble and
 * a name label for major NPCs.
 */
export class NPCSpriteController extends Phaser.GameObjects.Container {
  readonly npcId: string;
  private readonly figure: Phaser.GameObjects.Container;
  private readonly shadow: Phaser.GameObjects.Image;
  private readonly legs: Phaser.GameObjects.Image;
  private readonly torso: Phaser.GameObjects.Image;
  private readonly head: Phaser.GameObjects.Image;
  private readonly hair: Phaser.GameObjects.Image;
  private readonly armLeft: Phaser.GameObjects.Image;
  private readonly armRight: Phaser.GameObjects.Image;
  private readonly hat: Phaser.GameObjects.Image;
  private readonly label: Phaser.GameObjects.Text;
  private readonly bubble: Phaser.GameObjects.Container;
  private readonly bubbleBg: Phaser.GameObjects.Image;
  private readonly bubbleText: Phaser.GameObjects.Text;
  private readonly anchor: { x: number; y: number };
  private readonly palette: FigurePalette;
  private readonly seed: number;
  private lastBubbleSymbol = '';
  private bubbleTimer = 0;
  private clock = 0;
  private pose: FigurePose = 'idle';
  private minor: boolean;

  constructor(scene: Phaser.Scene, npc: NPCState, plan: LocationPlan) {
    const anchor = resolveNpcAnchor(plan, npc.id);
    super(scene, anchor.x, anchor.y);
    this.npcId = npc.id;
    this.anchor = anchor;
    this.palette = npcFigurePalette(npc.appearance);
    this.seed = npc.id.length * 31 + npc.age;
    this.minor = !npc.isMajor;

    this.shadow = scene.add.image(0, 1, 'fx.shadow').setOrigin(0.5, 0.5).setAlpha(0.5).setDisplaySize(15, 6);
    this.figure = scene.add.container(0, 0);
    this.legs = scene.add.image(0, 0, 'npc.legs').setOrigin(0.5, 1).setDisplaySize(13, 10).setTint(this.palette.secondary);
    this.torso = scene.add.image(0, -9, 'npc.torso.' + this.outfitKey()).setOrigin(0.5, 1).setTint(this.palette.primary);
    this.torso.setDisplaySize(16, 22);
    this.head = scene.add.image(0, -30, 'npc.head').setOrigin(0.5, 1).setTint(this.palette.skin);
    this.hair = scene.add.image(0, -37, 'npc.hair.' + this.hairKey()).setOrigin(0.5, 1).setTint(this.palette.hair);
    this.hat = scene.add.image(0, -42, 'npc.hat.cap').setOrigin(0.5, 1).setVisible(this.palette.accessory !== 'none');
    if (this.palette.accessory !== 'none') this.hat.setTint(0x8a5a6a);
    this.armLeft = scene.add.image(-7, -26, 'npc.arm').setOrigin(0.5, 0).setTint(this.palette.skin).setDisplaySize(4, 9);
    this.armRight = scene.add.image(7, -26, 'npc.arm').setOrigin(0.5, 0).setTint(this.palette.skin).setDisplaySize(4, 9);
    this.figure.add([this.legs, this.torso, this.armLeft, this.armRight, this.head, this.hair, this.hat]);
    this.figure.setScale(this.palette.scale);
    this.label = scene.add.text(0, -58, npc.name, {
      fontFamily: '"Courier New", monospace',
      fontSize: '9px',
      color: '#f2e8d4',
      stroke: '#1a161e',
      strokeThickness: 3,
      resolution: 2,
    });
    this.label.setOrigin(0.5, 1);
    this.label.setVisible(npc.isMajor);
    this.bubbleBg = scene.add.image(0, 0, 'ui.bubble').setOrigin(0.5, 1);
    this.bubbleText = scene.add.text(0, -3, '', {
      fontFamily: '"Courier New", monospace',
      fontSize: '11px',
      color: '#2a2228',
      resolution: 2,
    });
    this.bubbleText.setOrigin(0.5, 0.5);
    this.bubble = scene.add.container(0, -62, [this.bubbleBg, this.bubbleText]).setVisible(false);
    this.add([this.shadow, this.figure, this.label, this.bubble]);
    scene.add.existing(this);
    this.updateFromState(npc, 0, 0);
  }

  private outfitKey(): string {
    const outfit = this.palette.outfit;
    if (outfit === 'work' || outfit === 'formal' || outfit === 'elder' || outfit === 'outdoor' || outfit === 'artsy' || outfit === 'city') return outfit;
    return 'casual';
  }

  private hairKey(): string {
    const options = ['short', 'long', 'bun', 'bald'];
    return options[this.seed % options.length] ?? 'short';
  }

  private isAwake(pose: FigurePose): boolean {
    return pose !== 'sleep';
  }

  updateFromState(npc: NPCState, deltaMs: number, simTimeSeconds: number): void {
    this.clock += deltaMs;
    const activity = npc.currentActivity;
    const pose = activityPose(activity);
    this.pose = pose;
    const breath = npcBreath(npc.id, simTimeSeconds);
    const off = npcWalkOffset(npc.id, activity, simTimeSeconds, pose === 'walk' ? 52 : 26);
    const facing = npcFacing(npc.id, activity, simTimeSeconds);
    this.figure.setScale(facing * this.palette.scale, this.palette.scale);

    this.x = this.anchor.x + off.x;
    this.y = this.anchor.y + off.y;

    let bob = breath * 0.6;
    let figureY = 0;
    let rotation = 0;
    let arms = 0;
    this.legs.setVisible(true);
    if (pose === 'walk') {
      const cycle = figureWalkCycle(npc.id, simTimeSeconds);
      bob = Math.abs(Math.sin(cycle)) * 1.8;
      arms = Math.sin(cycle) * 0.5;
      this.legs.setScale(1, 0.85 + Math.abs(Math.sin(cycle)) * 0.3);
    } else if (pose === 'sit' || pose === 'read' || pose === 'eat') {
      figureY = 3;
      this.legs.setVisible(false);
      arms = -0.3;
    } else if (pose === 'sleep') {
      figureY = 4;
      rotation = 1.35;
      this.legs.setVisible(false);
    } else if (pose === 'work') {
      arms = Math.sin(this.clock * 0.006 + this.seed) * 0.7;
    } else if (pose === 'fish') {
      arms = -0.6;
      this.legs.setVisible(false);
      figureY = 2;
    } else if (pose === 'talk') {
      arms = Math.sin(this.clock * 0.004 + this.seed) * 0.25;
    }
    this.figure.y = figureY - bob;
    this.figure.rotation = rotation;
    this.armLeft.setRotation(-0.12 + arms);
    this.armRight.setRotation(0.12 - arms);
    this.shadow.setAlpha(pose === 'sleep' ? 0.25 : 0.5);

    // Emotion bubble - recomputed at 4 Hz is plenty and cheaper than every frame.
    this.bubbleTimer += deltaMs;
    if (this.bubbleTimer > 260) {
      this.bubbleTimer = 0;
      const bubble = npcEmotionBubble(npc);
      if (!bubble) {
        this.bubble.setVisible(false);
        this.lastBubbleSymbol = '';
      } else {
        if (bubble.symbol !== this.lastBubbleSymbol) {
          this.lastBubbleSymbol = bubble.symbol;
          this.bubbleText.setText(bubble.symbol);
          this.bubbleBg.setTint(bubble.tone);
        }
        this.bubble.setVisible(this.isAwake(pose));
        this.bubble.y = -60 + (pose === 'sleep' ? 6 : 0);
        this.bubble.setAlpha(0.75 + Math.sin(this.clock * 0.004) * 0.2);
      }
    }
    this.label.setAlpha(this.minor ? 0 : 0.92);
  }
}
