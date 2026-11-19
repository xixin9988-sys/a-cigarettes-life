import type {
  DialogueChoice,
  DialogueCondition,
  DialogueEffect,
  DialogueNode,
  DialogueTree,
} from '../schema';
import type { ItemId, Season, WeatherType } from '../../core/SharedTypes';
import { ITEM } from '../items/ids';
import { NPC } from '../npcs/ids';
import type { NPCId } from '../../core/SharedTypes';

/**
 * OWNER: Agent 10 (Social & Relationship).
 *
 * Structured, condition-gated dialogue trees. Every major NPC gets a bespoke
 * voice and a personal secret, shop treat and dream; the shared skeleton gives
 * each tree real branches (relationship gates, weather/time/flag variants,
 * once-only story beats) without duplicating eight hundred lines of plumbing.
 *
 * Condition/effect types come from src/data/schema.ts. Dynamic text is written
 * with {tokens} (see DialogueSystem.interpolateDialogueText):
 * {player} {npc} {weather} {season} {hour} {phase} {moisture} {location}
 * {affinity} {status} {mood} {money} {influence}.
 */

// ---------------------------------------------------------------------------
// Effect / condition shorthands
// ---------------------------------------------------------------------------
const rel = (affinity = 0, trust = 0, intimacy = 0): DialogueEffect => ({
  kind: 'relationship',
  affinity,
  trust,
  intimacy,
});
const remember = (text: string, importance: number, permanent = false): DialogueEffect => ({
  kind: 'memory',
  text,
  importance,
  permanent,
});
const setFlag = (flag: string, value = true): DialogueEffect => ({ kind: 'flag', flag, value });
const pay = (amount: number): DialogueEffect => ({ kind: 'money', amount });
const grant = (itemId: ItemId, quantity = 1): DialogueEffect => ({ kind: 'item', itemId, quantity });
const take = (itemId: ItemId, quantity = 1): DialogueEffect => ({ kind: 'item', itemId, quantity: -quantity });
const advanceGoal = (goalType: string): DialogueEffect => ({ kind: 'goal', goalType });
const gainInfluence = (amount: number): DialogueEffect => ({ kind: 'influence', amount });
const endDialogue: DialogueEffect = { kind: 'endConversation' };

const affinityMin = (value: number): DialogueCondition => ({ kind: 'affinityMin', value });
const trustMin = (value: number): DialogueCondition => ({ kind: 'trustMin', value });
const intimacyMin = (value: number): DialogueCondition => ({ kind: 'intimacyMin', value });
const statusIn = (...statuses: string[]): DialogueCondition => ({ kind: 'status', statuses });
const hasItem = (itemId: ItemId): DialogueCondition => ({ kind: 'hasItem', itemId });
const weatherIn = (...weathers: WeatherType[]): DialogueCondition => ({ kind: 'weather', weathers });
const seasonIn = (...seasons: Season[]): DialogueCondition => ({ kind: 'season', seasons });
const hourBetween = (from: number, to: number): DialogueCondition => ({ kind: 'hourRange', from, to });
const flagIs = (flag: string, equals = true): DialogueCondition => ({ kind: 'flag', flag, equals });
const moodMin = (value: number): DialogueCondition => ({ kind: 'moodMin', value });
const moistureMin = (value: number): DialogueCondition => ({ kind: 'moistureMin', value });
const seenBefore = (value: boolean): DialogueCondition => ({ kind: 'seenBefore', value });
const chanceOf = (chance: number): DialogueCondition => ({ kind: 'probability', chance });

// ---------------------------------------------------------------------------
// Shared neutral choices
// ---------------------------------------------------------------------------
const BACK: DialogueChoice = { id: 'back', text: 'Steer the conversation somewhere easier.', next: 'root' };
const BYE: DialogueChoice = { id: 'bye', text: 'Say goodbye and let them get on with their day.', next: 'bye' };

function closeChoices(): DialogueChoice[] {
  return [BACK, BYE];
}

// ---------------------------------------------------------------------------
// Major NPC dialogue configuration
// ---------------------------------------------------------------------------
interface MajorDialogueConfig {
  npcId: NPCId;
  /** Base root line (supports {tokens}). */
  root: string;
  /** Root variants: player soaking wet, rain/storm, late night, long friendship, secret kept. */
  soaked: string;
  rainy: string;
  night: string;
  warm: string;
  afterSecret: string;
  /** greetingByStatus nodes. */
  greetAcquaintance: string;
  greetFriend: string;
  greetDating: string;
  greetCold: string;
  greetAwkward: string;
  /** Casual conversation beat. */
  chat: string;
  chatAlt: string;
  chatDeep: string;
  dream: string;
  /** Occupation beat + small shop treat. */
  work: string;
  workThanks: string;
  shopLabel: string;
  shopItemId: ItemId;
  shopPrice: number;
  shopSuccess: string;
  workHelpReply: string;
  /** What helping them earns. */
  helpRewardEffects: DialogueEffect[];
  /** Honest rumour beat. */
  rumour: string;
  rumourKeep: string;
  rumourSpread: string;
  /** Optional romance branch (only used when romanceable). */
  flirt?: string;
  flirtWarm?: string;
  /** Optional community/town beat (used when not romanceable). */
  community?: string;
  /** A deeply personal moment (gated on trust). */
  special: string;
  specialEffects: DialogueEffect[];
  /** Gift reaction text. */
  gift: string;
  secretFlag: string;
  goalType: string;
  giftItemId: ItemId;
  romanceable: boolean;
  emotion: 'happy' | 'sad' | 'angry' | 'surprised' | 'neutral' | 'shy';
}

// ---------------------------------------------------------------------------
// Tree builder
// ---------------------------------------------------------------------------
function buildMajorTree(config: MajorDialogueConfig): DialogueTree {
  const nodes: Record<string, DialogueNode> = {};
  const keptFlag = config.secretFlag + '_kept';
  const spreadFlag = config.secretFlag + '_spread';

  const topicChoices = (): DialogueChoice[] => {
    const choices: DialogueChoice[] = [
      { id: 'chat', text: 'Ask how they have been keeping.', next: 'chat' },
      { id: 'work', text: 'Talk shop with them.', next: 'work' },
      {
        id: 'rumour',
        text: 'Ask about the thing they have been sitting on.',
        conditions: [affinityMin(25)],
        next: 'rumour',
      },
    ];
    if (config.romanceable) {
      choices.push({ id: 'flirt', text: 'Let the conversation turn warmer.', next: 'flirt' });
    } else if (config.community) {
      choices.push({ id: 'community', text: 'Ask after the town and its plans.', next: 'community' });
    }
    choices.push(
      {
        id: 'special',
        text: 'Ask about the thing they never talk about.',
        conditions: [trustMin(35), affinityMin(40)],
        once: true,
        next: 'special',
      },
      {
        id: 'gift',
        text: 'Offer them the ' + config.giftItemId.replace(/_/g, ' ') + ' you have been carrying.',
        conditions: [hasItem(config.giftItemId)],
        once: true,
        next: 'gift',
      },
      { id: 'bye', text: 'Say goodbye.', next: 'bye' }
    );
    return choices;
  };

  // Dynamic text variants are shared by the root node and every greeting node so
  // that weather/time/wetness/affinity always colour the first line the player sees.
  const greetingVariants: { conditions: DialogueCondition[]; text: string }[] = [
    { conditions: [flagIs(keptFlag)], text: config.afterSecret },
    { conditions: [moistureMin(0.6)], text: config.soaked },
    { conditions: [weatherIn('rain', 'storm')], text: config.rainy },
    { conditions: [hourBetween(22, 5)], text: config.night },
    { conditions: [affinityMin(55)], text: config.warm },
    { conditions: [chanceOf(0.25)], text: config.root + ' They glance at the {weather} outside and shake their head.' },
  ];

  const greetingNode = (id: string, text: string): DialogueNode => ({
    id,
    text,
    emotion: config.emotion,
    variants: greetingVariants,
    choices: topicChoices(),
  });

  nodes.root = {
    id: 'root',
    text: config.root,
    emotion: config.emotion,
    variants: greetingVariants,
    choices: topicChoices(),
  };
  nodes['greet_acquaintance'] = greetingNode('greet_acquaintance', config.greetAcquaintance);
  nodes['greet_friend'] = greetingNode('greet_friend', config.greetFriend);
  nodes['greet_dating'] = greetingNode('greet_dating', config.greetDating);
  nodes['greet_cold'] = greetingNode('greet_cold', config.greetCold);
  nodes['greet_awkward'] = greetingNode('greet_awkward', config.greetAwkward);

  nodes.chat = {
    id: 'chat',
    text: config.chat,
    emotion: config.emotion,
    variants: [{ conditions: [chanceOf(0.4)], text: config.chatAlt }],
    choices: [
      {
        id: 'chat_deep',
        text: 'Ask them something real.',
        conditions: [affinityMin(12)],
        once: true,
        effects: [rel(2, 1, 0), remember('The cigarette asked them something real, and actually listened.', 22)],
        next: 'chat_deep',
      },
      {
        id: 'chat_dream',
        text: 'Ask what they would do if the world were kinder.',
        conditions: [affinityMin(28)],
        once: true,
        effects: [advanceGoal(config.goalType), rel(1, 1, 0)],
        next: 'dream',
      },
      BACK,
      BYE,
    ],
  };
  nodes.chat_deep = {
    id: 'chat_deep',
    text: config.chatDeep,
    emotion: config.emotion,
    choices: closeChoices(),
  };
  nodes.dream = {
    id: 'dream',
    text: config.dream,
    emotion: 'happy',
    choices: closeChoices(),
  };

  nodes.work = {
    id: 'work',
    text: config.work,
    emotion: 'happy',
    choices: [
      {
        id: 'work_praise',
        text: 'Tell them their work is genuinely good.',
        once: true,
        effects: [rel(2, 1, 0)],
        next: 'work_thanks',
      },
      {
        id: 'work_buy',
        text: config.shopLabel,
        effects: [pay(-config.shopPrice), grant(config.shopItemId, 1)],
        next: 'work_buy',
      },
      {
        id: 'work_help',
        text: 'Offer to take some weight off their hands.',
        conditions: [affinityMin(18)],
        once: true,
        effects: [rel(3, 2, 0), ...config.helpRewardEffects],
        next: 'work_help',
      },
      BACK,
      BYE,
    ],
  };
  nodes.work_thanks = {
    id: 'work_thanks',
    text: config.workThanks,
    emotion: 'happy',
    choices: closeChoices(),
  };
  nodes.work_help = {
    id: 'work_help',
    text: config.workHelpReply,
    emotion: 'happy',
    choices: closeChoices(),
  };
  nodes.work_buy = {
    id: 'work_buy',
    text: config.shopSuccess,
    emotion: 'happy',
    choices: closeChoices(),
  };

  nodes.rumour = {
    id: 'rumour',
    text: config.rumour,
    emotion: 'shy',
    choices: [
      {
        id: 'rumour_keep',
        text: 'Promise to keep it to yourself.',
        once: true,
        effects: [
          setFlag(keptFlag),
          rel(1, 3, 0),
          remember('The cigarette kept their confidence. That is worth something.', 46),
        ],
        next: 'rumour_keep',
      },
      {
        id: 'rumour_spread',
        text: 'A secret this good will not stay secret for long.',
        once: true,
        effects: [setFlag(spreadFlag), gainInfluence(2), rel(-2, -1, 0)],
        next: 'rumour_spread',
      },
      BACK,
      BYE,
    ],
  };
  nodes.rumour_keep = {
    id: 'rumour_keep',
    text: config.rumourKeep,
    emotion: 'shy',
    choices: closeChoices(),
  };
  nodes.rumour_spread = {
    id: 'rumour_spread',
    text: config.rumourSpread,
    emotion: 'angry',
    choices: closeChoices(),
  };

  if (config.romanceable) {
    nodes.flirt = {
      id: 'flirt',
      text: config.flirt ?? 'They hold your gaze a beat too long.',
      emotion: 'shy',
      variants: [
        {
          conditions: [statusIn('dating', 'partner'), intimacyMin(10)],
          text: config.flirtWarm ?? config.flirt ?? 'You and they have grown used to standing close.',
        },
      ],
      choices: [
        {
          id: 'flirt_warm',
          text: 'Say something honest back.',
          once: true,
          effects: [rel(2, 1, 3), remember('The cigarette answered warmth with warmth. No games, no pretence.', 50)],
          next: 'flirt_warm',
        },
        BACK,
        BYE,
      ],
    };
    nodes.flirt_warm = {
      id: 'flirt_warm',
      text:
        config.flirtWarm ??
        'They smile at their boots, then at you, and the moment settles into something comfortable.',
      emotion: 'happy',
      choices: closeChoices(),
    };
  }

  if (config.community) {
    nodes.community = {
      id: 'community',
      text: config.community,
      emotion: 'neutral',
      choices: [
        {
          id: 'community_support',
          text: 'Say you will back whatever the town decides.',
          once: true,
          effects: [rel(1, 1, 0), gainInfluence(1), setFlag('community_discussed:' + config.npcId)],
          next: 'root',
        },
        BACK,
        BYE,
      ],
    };
  }

  nodes.special = {
    id: 'special',
    text: config.special,
    emotion: 'sad',
    effects: config.specialEffects,
    choices: closeChoices(),
  };

  nodes.gift = {
    id: 'gift',
    text: config.gift,
    emotion: 'surprised',
    effects: [
      take(config.giftItemId, 1),
      rel(4, 1, 1),
      remember('The cigarette gave them ' + config.giftItemId.replace(/_/g, ' ') + '. They did not expect it.', 52),
      setFlag('dialogue_gift:' + config.npcId),
    ],
    choices: closeChoices(),
  };

  nodes.bye = {
    id: 'bye',
    text: 'You leave {npc} to the rest of their day. The {weather} follows you out.',
    emotion: 'neutral',
    effects: [endDialogue],
  };

  return {
    id: 'dialogue_' + config.npcId,
    npcId: config.npcId,
    rootNodeId: 'root',
    nodes,
    greetingByStatus: {
      stranger: 'greet_acquaintance',
      acquaintance: 'greet_acquaintance',
      friend: 'greet_friend',
      close_friend: 'greet_friend',
      dating: 'greet_dating',
      partner: 'greet_dating',
      rival: 'greet_cold',
      enemy: 'greet_cold',
      ex: 'greet_awkward',
    },
  };
}


// ---------------------------------------------------------------------------
// The fourteen neighbours of Willowbrook and Ashford
// ---------------------------------------------------------------------------
const MAJOR_DIALOGUE_CONFIGS: MajorDialogueConfig[] = [
  // 1. Marigold Lyle - florist, warm, always has soil under her nails.
  {
    npcId: NPC.marigoldLyle,
    root: 'Marigold is elbow-deep in a bucket of roses when she looks up. “There you are, {player}. The {season} has been kind to the garden, if not to my back.”',
    soaked:
      'Marigold takes one look at you and laughs. “You are dripping on the tulips, {player}. Come under the awning before you catch something worse than a cold.”',
    rainy:
      '“Rain again,” Marigold says, wiping her hands on her apron. “Good for the beds. Bad for the till. Stay a while and keep me company.”',
    night:
      'The flower shop is dark except for a lantern by the counter. “Late wanderer,” Marigold says without turning round. “The roses are asleep. So should you be.”',
    warm:
      'Marigold saves you a flower from every cutting, and has for weeks. “You are good for this place,” she says. “I do not say that to everyone.”',
    afterSecret: '“You kept my confidence,” Marigold says quietly, snipping a stem. “I do not forget that. Here - for luck.”',
    greetAcquaintance:
      'Marigold greets you with a nod, already reaching for a ribbon. “Something for the windowsill, or just company?”',
    greetFriend:
      '“{player}! I was hoping you would come by.” Marigold pulls a stool out from behind the counter. “Sit. The roses can wait a minute.”',
    greetDating:
      'Marigold looks up and the whole shop seems brighter. “There is my trouble,” she says, and tucks a loose stem behind your ear.',
    greetCold:
      'Marigold keeps working and says nothing for a moment too long. “If you have come to buy something, buy it. If not, the door is behind you.”',
    greetAwkward:
      'Marigold busies herself with a wilted stem. “...You look well,” she says at last, and does not meet your eye.',
    chat: 'She tells you about the wedding order she has been working on for two weeks - white roses, lavender, and one stubborn carnation that refuses to behave.',
    chatAlt:
      'Marigold talks about the garden behind the shop as though it were a person: the old pear tree is sulking, the lavender is showing off, the foxgloves are getting above themselves.',
    chatDeep:
      'Her hands go still on the counter. “Nobody asks me that.” Marigold smiles, a little crooked. “I sell flowers because they are the one thing that never lies about how short a good thing lasts.”',
    dream: '“If I could do anything?” She looks out of the window. “A garden the whole village could sit in. Not mine - ours. Somewhere people go when they are sad and leave feeling less alone.”',
    work: 'Marigold shows you the day’s arrangements: a funeral wreath, a birthday bouquet and a single rose in a jam jar for a woman who comes every Tuesday.',
    workThanks: '“You have a good eye,” Marigold says, surprised into honesty. “Better than the customers. Do not tell them I said so.”',
    shopLabel: 'Buy a single perfect rose (£2.20).',
    shopItemId: ITEM.rose,
    shopPrice: 220,
    shopSuccess: 'She picks the rose with the most outrageous little thorns and wraps it in brown paper. “Mind yourself. The best ones always draw blood.”',
    workHelpReply: 'You sweep the shop floor and haul a bucket while Marigold clips and chats. By the time you are done, the shop smells twice as good and she is looking at you differently.',
    helpRewardEffects: [grant(ITEM.lavender, 1), rel(1, 1, 0)],
    rumour:
      'Marigold lowers her voice. “There is a garden behind the old wall, three streets over. Somebody still tends it. Nobody will say who. I leave a posy at the gate sometimes, and it is always gone by morning.”',
    rumourKeep: '“Thank you,” she says, and means it. “Small village. Small kindnesses.” She presses her lips together and hands you the rose she has been trimming.',
    rumourSpread: 'Marigold hears you tell a customer, and the customer tells two more. By evening half the village is talking about the hidden garden. Marigold does not look at you when you come back.',
    flirt: 'Marigold catches you watching her hands and colours, just a little. “They are just flowers,” she says, and does not sound convinced.',
    flirtWarm: 'She sets the shears down. “I am not good at this,” she says quietly. “But I am glad it is you.”',
    special:
      '“My mother planted the first bed in this shop,” Marigold says. “When she died I nearly sold the place.” She touches the counter. “I stayed. Some roots you do not pull up.”',
    specialEffects: [grant(ITEM.pressedFlower, 1), rel(1, 2, 0), advanceGoal('garden')],
    gift: 'Marigold unwraps the {gift} and holds it up. “You remembered,” she says, and her voice does something complicated.',
    secretFlag: 'secret_hidden_garden',
    goalType: 'garden',
    giftItemId: ITEM.pressedFlower,
    romanceable: true,
    emotion: 'happy',
  },
  // 2. Otto Bramwell - baker, hearty, up before the birds.
  {
    npcId: NPC.ottoBramwell,
    root: 'The whole bakery smells like a warm promise. Otto wipes flour from his hands on his apron. “{player}! Good timing. I am between batches and halfway to mad.”',
    soaked:
      'Otto laughs so hard the bread tray rattles. “You look like a dropped loaf! Get in here, get dry, and do not touch anything until you stop dripping.”',
    rainy:
      '“Rain?” Otto shrugs, sliding a tray into the oven. “Rain means people want soup and bread. Business is never bad for me, only for the ones who have to stand in it.”',
    night:
      'He must have been here since four in the morning. Otto yawns enormously. “The dough does not care what time it is. Neither, apparently, do you.”',
    warm:
      'Otto tears a warm roll in half and gives you the bigger one before you can argue. “You eat too little, and you sit too quietly. You are a good sort, {player}.”',
    afterSecret: 'Otto nods at you across the counter, and there is a new weight in it. “My father’s recipe stays between us. You are family now, whether you like it or not.”',
    greetAcquaintance: 'Otto brandishes a wooden spoon like a sceptre. “Weclome in - mind the step. Bread or gossip? I have not enough of either to spare, so choose fast.”',
    greetFriend: '“There he is!” Otto bellows, and slaps the counter. “I saved you the corner piece. It is the best one, and do not let anyone tell you different.”',
    greetDating: 'Otto turns bright red and waves you behind the counter. “Come here. I have made something for you and it is embarrassing, so please eat it before I say anything.”',
    greetCold:
      'Otto keeps his eyes on the dough. “If you are here to buy, I will sell. Otherwise I have a batch that needs me more than you do.”',
    greetAwkward: 'Otto’s shoulders drop. “I keep expecting you to come in at the usual time,” he says, and then, quietly, “Take a loaf. On the house.”',
    chat: 'Otto complains about the flour delivery, the price of butter and the new apprentice who cannot tell a proof from a punch. “Three months,” he says. “Three months and he calls a croissant a crescent.”',
    chatAlt: 'He talks about the village football team as if they were his own children: the good, the hopeless, and the goalkeeper who has never once kept a clean sheet.',
    chatDeep: 'Otto leans on the counter. “Baking is the only thing I have ever been sure about. Everything else - family, money, whether people actually like me - I am making it up as I go.”',
    dream: '“A bakery big enough for a proper breakfast room,” Otto says. “Long tables. Anyone can sit. Nobody pays if they cannot. That is the whole dream. It is not a very clever one, but it is mine.”',
    work: 'He walks you through the morning: sourdough, cottage loaves, and a tray of cinnamon knots that are already gone. “That is it. That is the day. It eats you alive, and then it is over.”',
    workThanks: 'Otto goes quiet, then shrugs, embarrassed. “I do not hear that very often. Thank you.”',
    shopLabel: 'Buy a warm loaf (£1.80).',
    shopItemId: ITEM.breadLoaf,
    shopPrice: 180,
    shopSuccess: 'He bags the loaf and adds a second one. “That one is for tomorrow. Or tonight. I do not judge.”',
    workHelpReply: 'Otto hands you a heavy sack and sets you to work. An hour later then flour has found every crease of you and the bakery is spotless, and he is laughing at the state of you.',
    helpRewardEffects: [grant(ITEM.flour, 1), rel(1, 1, 0)],
    rumour:
      '“Keep this under your hat,” Otto says, glancing at the door. “The old farmhouse is not as empty as it looks. Somebody has been mending the roof. I leave bread on the step. It always goes.”',
    rumourKeep: '“Good lad,” Otto says, and his voice is warm. “Not every promise is worth the breath, but that one was.”',
    rumourSpread: 'Otto hears his own story in the market the next day, told badly and loudly. When you come in, he is polite and distant, and the bread is not as warm as it used to be.',
    community:
      'Otto leans on the counter. “The town needs a proper breakfast room, not a bench and a bit of hope. I would back that with every loaf I own. You are the one with ideas - what would you do with this place if it were yours?”',
    special:
      '“My father drank,” Otto says suddenly, wiping the counter that does not need wiping. “When he died I found his recipe book with a page torn out. I have looked for that page for eleven years.”',
    specialEffects: [grant(ITEM.pieDough, 1), rel(0, 2, 0), advanceGoal('bakery')],
    gift: 'Otto turns the {gift} over twice. “For me? What - what is this for?” He looks almost frightened by the kindness.',
    secretFlag: 'secret_abandoned_farmhouse_roof',
    goalType: 'bakery',
    giftItemId: ITEM.honeyJar,
    romanceable: false,
    emotion: 'happy',
  },
  // 3. Sylvia Reed - cafe owner, gossip with a heart of gold.
  {
    npcId: NPC.sylviaReed,
    root: 'Sylvia is leaning on the counter like it is the most comfortable place in the village. “{player}. Sit. You look like a rumour that needs somewhere to land.”',
    soaked:
      '“Oh, you poor thing,” Sylvia says, already reaching for a towel. “Come here. That is it. Now tell me everything and do not skip the embarrassing parts.”',
    rainy:
      'Rain streams down the cafe windows and Sylvia looks satisfied. “Best weather for business there is. Nobody in this village can sit at home with their own thoughts.”',
    night:
      'The cafe is winding down, chairs up, and Sylvia is still talking. “The night is early, {player}. Sit down. One cup. You will be home before your cigarette burns past the filter.”',
    warm:
      'Sylvia slides a plate across the counter before you ask. “I know how you take it and I know what you want. This is what happens when you keep coming back.”',
    afterSecret: '“You did not tell a soul,” Sylvia mutters, refilling your cup without asking. “I have misjudged people before. It is nice to be wrong in that direction.”',
    greetAcquaintance: 'Sylvia greets you with a raised eyebrow and a clean cup. “The usual, or are we being adventurous today?”',
    greetFriend: '“Here comes trouble,” Sylvia announces, delighted. “Sit anywhere. I will be with you in a minute that will certainly become ten.”',
    greetDating: 'Sylvia’s whole face changes. She unties her apron. “Tell the kitchen I am taking a break. Sit down properly. Let me look at you.”',
    greetCold:
      'Sylvia wipes the counter in front of you, slowly. “If you want to be served, you will have to wait until I am finished with this. I have a lot of counter to wipe.”',
    greetAwkward: '“Ah,” Sylvia says, and her voice goes carefully neutral. “You will want to sit somewhere else, I think. I will send the tea over.”',
    chat: 'She has news about everyone: the baker’s apprentice, the postman’s knee, the museum curator’s new glasses. “None of it is important, {player}. That is what makes it worth knowing.”',
    chatAlt: 'Sylvia tells the story of the two men who argued about the crossword for forty minutes and then discovered they were cousins. She has told it before. It gets better every time.',
    chatDeep: 'She frowns into her cup. “People think I am just nosy. Maybe I am. But I know every lonely soul in this village by name, and I keep an eye on all of them. Somebody has to.”',
    dream: '“I would keep this cafe open all night,” Sylvia says. “For the ones who have nowhere to go at three in the morning. Tea, a bit of cake, and somebody to notice you are there.”',
    work: 'Sylvia shows you the day: the morning rush, the lunch crowd, and the quiet hour in the afternoon when she reads the paper and does the crossword in pen.',
    workThanks: 'She actually stops talking for a second. “You are paying attention. Most people are just waiting for their turn to talk.”',
    shopLabel: 'Buy a cup of tea and a slice of cake (£2.50).',
    shopItemId: ITEM.teaCup,
    shopPrice: 250,
    shopSuccess: '“There,” Sylvia says, setting down a slice that would frighten a reasonable person. “Eat. You look like a wet match.”',
    workHelpReply: 'You carry trays and wash up for an hour while Sylvia works the room like a conductor. She tips you with a scandal and a second piece of cake.',
    helpRewardEffects: [grant(ITEM.applePie, 1), rel(1, 1, 0)],
    rumour:
      '“I should not tell you this,” Sylvia says, and immediately does. “The old well behind the church - somebody has been down it. I saw the rope. Rope does not tie itself, {player}.”',
    rumourKeep: '“Good,” Sylvia says, and covers your hand with hers for a second. “I talk too much. It is nice to have someone else hold a thing for me.”',
    rumourSpread: 'By evening the whole cafe is talking about the well. Sylvia hears you at the centre of it and stops refilling your cup, which for her is a declaration of war.',
    flirt: 'Sylvia notices you looking and grins like a cat. “Careful, {player}. I bite. Slowly.”',
    flirtWarm: 'She leans across the counter. “There is nobody worth shutting up for in this village,” she says. “Except, apparently, you.”',
    special:
      '“My husband left,” Sylvia says, matter-of-fact, and then pats the counter. “Fifteen years ago. I kept the cafe because it was mine, not his. This place is the best thing I ever told him he could not have.”',
    specialEffects: [grant(ITEM.strawberryCake, 1), rel(1, 2, 1), advanceGoal('cafe')],
    gift: 'Sylvia unwraps the {gift} and then looks at you for a while. “You know,” she says, “people bring me things to buy my attention. That is not what this is. Is it?”',
    secretFlag: 'secret_ancient_well_rope',
    goalType: 'cafe',
    giftItemId: ITEM.teaLeaves,
    romanceable: true,
    emotion: 'happy',
  },
  // 4. Harold Bagg - postman, weather-beaten, knows every doorstep.
  {
    npcId: NPC.haroldBagg,
    root: 'Harold is sorting a bundle of letters on a wall. “{player}. Rain or shine, I am out here. Mostly rain.” He squints. “The {weather} today is a letter-carrier’s weather. That is not a compliment.”',
    soaked:
      'Harold hands you a dry cloth from his satchel without a word. “Letter bags are waterproof. Cigarettes, apparently, are not.”',
    rainy:
      '“Fourteen letters,” Harold says, holding up a soggy stack. “Thirteen dry. One delivered twice because the address was written by a lunatic. Rain is my whole day now.”',
    night:
      'He is still walking the lanes long after dark. “Last round,” he says. “I say that a lot. The letters do not stop and neither do I.”',
    warm: 'Harold walks slower than he needs to when you are with him. “Not many people keep an old man company on his rounds,” he says. “I notice.”',
    afterSecret: 'Harold touches his cap when he sees you. “A man’s route is like his confessions. Nobody knows it unless he chooses to tell them. Thank you for keeping it.”',
    greetAcquaintance: 'Harold nods, shifting his bag to the other shoulder. “Morning. Or whatever it is. Walk with me if you are heading the same way.”',
    greetFriend: '“Here he is,” Harold says, and offers you half a sandwich that has been in his bag since breakfast. “Do not ask. It is cheese. Probably.”',
    greetDating: 'Harold stops in the lane and takes his cap off. “There is nobody on my route who would believe me,” he says, “but you make an old man ridiculous.”',
    greetCold:
      'Harold walks past you with a nod that is not quite a greeting. “Busy round today,” he says, and does not stop.',
    greetAwkward:
      'Harold pretends to be reading a label that he has read four times already. “I will be out of your way in a moment,” he says.',
    chat: 'Harold knows which doors get no letters, which ones get too many, and which ones have been empty for years. He does not tell anyone. He also notices everything.',
    chatAlt: 'He talks about the postal service like an old general about a war he mostly won. “We were faster before the war. But the war was before everything.”',
    chatDeep: '“I walk thirty miles a week,” Harold says. “I know this village better than anyone alive. Some days I think it is the only thing I know at all.”',
    dream: '“Honestly?” He thinks about it. “A letter with no address on it. Just my name. Somebody telling me I did all right.”',
    work: 'Harold shows you the route book: names, numbers, small annotations in pencil. “Mrs Hale takes deliveries at the back door. The widower on the corner does not want post before eleven. Kindness is mostly scheduling.”',
    workThanks: 'Harold looks at his boots. “I am not used to being told I do a good job. I will think about that on the walk.”',
    shopLabel: 'Buy a sheet of stamps and a pressed ink pad (£1.60).',
    shopItemId: ITEM.ink,
    shopPrice: 160,
    shopSuccess: 'He counts out the stamps carefully. “There. If you ever write to anyone, write properly. It is the last polite thing left.”',
    workHelpReply: 'You carry the heavy bundle and knock on doors while Harold rests his knee. He tells you stories the whole way, and by the end you can see the village the way he does.',
    helpRewardEffects: [grant(ITEM.paper, 1), rel(1, 1, 0)],
    rumour:
      'Harold stops walking. “There is a letter that has been in my bag for two years,” he says. “No stamp. No address except a name. The name is not in this village.” He looks at you. “I have not delivered it. I have not burned it.”',
    rumourKeep: '“Thank you,” Harold says, and walks on. “Some things a man carries better than he hands off.”',
    rumourSpread: 'The story gets out and Harold does not deny it. He also does not walk your way for a week. The letters still come, though.',
    community:
      'Harold nods at the lane. “Half these houses are empty and the other half are full of people who never speak. What this village needs is a reason to knock on a door that has nothing to do with post.”',
    special:
      '“I have delivered bad news,” Harold says quietly. “Three times. Twice to the same house. The first one I carried for an hour before I knocked.” He looks at his hands. “I still hear the kettle stop.”',
    specialEffects: [grant(ITEM.oldLetter, 1), rel(0, 3, 0), advanceGoal('post')],
    gift: 'Harold opens the package with the care of a man handling something breakable. “For me?” he says. “I am not sure anyone has bought me a present since I was a boy.”',
    secretFlag: 'secret_undelivered_letter',
    goalType: 'post',
    giftItemId: ITEM.oldLetter,
    romanceable: false,
    emotion: 'neutral',
  },
  // 5. Eliza Thorne - retired librarian, keeper of local history.
  {
    npcId: NPC.elizaThorne,
    root: 'Eliza is on a bench with a notebook and a stack of index cards. “{player}. Sit. I am in the middle of remembering something and it needs witnesses.”',
    soaked:
      '“Oh, look at you.” Eliza folds her notebook shut and makes room on the bench. “Sit in the dry spot. I have lived long enough to know a thing or two about catching your death.”',
    rainy:
      'Eliza watches the rain with satisfaction. “Perfect library weather. Nobody will expect anything of me today, and I have three hours of history to sort out.”',
    night:
      'The bench is empty except for the streetlamp and Eliza, who should have gone home hours ago. “I lose track of time,” she says. “It is the only good thing about growing old.”',
    warm:
      'Eliza saves the interesting cuttings for you. “You are one of the few people in this village who wants to know why,” she says. “That is rare, and it is worth feeding.”',
    afterSecret: '“You did not laugh,” Eliza says. “Half this village would have laughed. That is why I told you and not them.”',
    greetAcquaintance: 'Eliza marks her page. “Hello, {player}. I have been cataloguing the village’s oldest boundary stones. A more exciting sentence than it sounds, I promise.”',
    greetFriend: '“Good, good,” Eliza says, waving you over. “I need a second opinion on something that happened in 1882, and you are the closest thing to a peer this village offers.”',
    greetDating: 'Eliza sets her notebook down entirely. “Well then,” she says, and smiles like a woman who has decided to stop being sensible for an hour.',
    greetCold:
      'Eliza continues writing. “I am not good at arguments,” she says. “I am exceptional at silence. Do sit somewhere else.”',
    greetAwkward: '“Ah.” Eliza turns a page that does not need turning. “I was not sure you would still want to talk to me. I am glad to be wrong.”',
    chat: 'She tells you about the map of the village drawn in 1904, and the fact that three streets have been moved, renamed, or quietly deleted from every survey since.',
    chatAlt: 'Eliza has a story about the schoolhouse fire, the flood of ’62 and the mayor who was, on closer inspection, two mayors. She never tells them the same way twice.',
    chatDeep: '“Why do I care?” She looks at her cards. “Because when nobody remembers, things become lies. I am not willing to let this village become a lie.”',
    dream: '“I would write it all down properly,” Eliza says. “Not the sort of history that only mentions mayors. The bakehouse, the well, the woman who kept bees. All of it.”',
    work: 'Eliza shows you her index cards: births, businesses, quarrels, the oldest well, the boundary stones. “Every card is a person who was here. That is the whole system.”',
    workThanks: 'Eliza is pleased in a way that makes you feel like a student who has finally impressed the teacher. “You have an eye for detail,” she says. “Do not waste it.”',
    shopLabel: 'Buy a copy of her local history pamphlet (£3.00).',
    shopItemId: ITEM.localHistoryBook,
    shopPrice: 300,
    shopSuccess: 'She hands it over with both hands. “Page fourteen is the best. Do not skip page fourteen.”',
    workHelpReply: 'You carry her box of cards to the library and help her sort them by decade. It takes an hour and you learn more about the village than in years of living in it.',
    helpRewardEffects: [grant(ITEM.oldClue, 1), advanceGoal('history')],
    rumour:
      'Eliza glances around the square. “The old mill,” she says. “There was a fire there in 1921. The record says it was an accident. I have two letters that suggest otherwise, and they do not agree with each other.”',
    rumourKeep: '“Good,” Eliza says, and writes something in her notebook. “I will put your name in the acknowledgements. Or I would, if I ever finish the book.”',
    rumourSpread: 'Eliza hears the mill fire story repeated in the street, wrong in every particular. “I will not make that mistake again,” she says, and gathers her cards.',
    community:
      'Eliza taps her index cards. “The town keeps building things and forgetting why. Any proposal that means somebody will still care in fifty years has my vote. Write it down properly and I will help you make the case.”',
    special:
      '“I was a librarian for forty years,” Eliza says. “I saved every book the council wanted removed. Three hundred and twelve. They are in my attic.” She smiles. “I am not a saint. I just did not like being told what to think.”',
    specialEffects: [rel(1, 2, 1), setFlag('eliza_archive_revealed')],
    gift: 'Eliza turns the {gift} over and holds it up to the light. “Well,” she says. “This is a good object. You have taste, which is a rarer thing than kindness.”',
    secretFlag: 'secret_mill_fire',
    goalType: 'history',
    giftItemId: ITEM.localHistoryBook,
    romanceable: false,
    emotion: 'neutral',
  },
  // 6. Theo Grey - shy bookshop owner.
  {
    npcId: NPC.theoGrey,
    root: 'Theo looks up over the top of a book, and the stool he is standing on wobbles. “Oh - hello, {player}. Sorry. I was - I was sorting.” He is not sorting. He is reading.',
    soaked:
      'Theo nearly falls off the stool. “You are soaked! Take - here, take this.” He presses a tea towel on you and then finds he is holding it too, and lets go very quickly.',
    rainy:
      '“Rain,” Theo says, and looks almost pleased. “It is my best weather. Nobody feels guilty about staying inside with a book.”',
    night:
      'The shop should be closed. Theo is reading by a tilting lamp. “I lost track,” he admits. “It is a flaw. It is also the only reason I own a bookshop.”',
    warm:
      'Theo slides a book across the counter at you. “I saw this and thought of you. It is a first edition, well - a now edition. It is yours. Do not argue.”',
    afterSecret: 'Theo’s ears go pink when you come in. “You did not tell anyone,” he says. “I checked. Not that I was checking. I was just noticing.”',
    greetAcquaintance: 'Theo waves from behind a stack. “Hello. I am here. Behind these. It is why I chose this shop.”',
    greetFriend: '“You are here!” Theo is delighted and immediately coughs, trying to look calm. “I mean. Hello. I have a chair. It is the good one.”',
    greetDating: 'Theo forgets the book in his hands and it clatters to the floor. “Oh,” he says, going scarlet. “Hello. You are - hi.”',
    greetCold:
      'Theo shrinks a little. “I - I will leave you to browse,” he says, and disappears behind the poetry shelf, where he can still be seen, badly.',
    greetAwkward: 'Theo turns a page without reading it. “I have been meaning to say something,” he says, and then does not say anything.',
    chat: 'He tells you about the book he has been reading and then is embarrassed to have told you that much, and then, unable to stop himself, tells you the rest.',
    chatAlt: 'Theo talks about the shop’s true crime section with a completely unearned confidence, and you both end up laughing at nothing in particular.',
    chatDeep: '“I am not shy,” Theo says, in the way of somebody who has thought about this a great deal. “I am just very bad at being perceived. It is different.”',
    dream: '“A reading room,” he says immediately, then softens. “With a chair nobody makes you get out of. And people. A few people. Talking about books without being awful about it.”',
    work: 'Theo shows you the new arrivals, the shelf that needs mending, and the poetry section, about which he has firm and slightly terrifying opinions.',
    workThanks: 'Theo fidgets with his sleeves. “That is - I do not get that a lot. Thank you. I am going to think about it later, in a good way.”',
    shopLabel: 'Buy a bound recipe collection (£4.50).',
    shopItemId: ITEM.recipeBook,
    shopPrice: 450,
    shopSuccess: 'He wraps it in brown paper and ties the string in a bow that takes him three attempts. “Sorry. I am better with books than string.”',
    workHelpReply: 'You climb a ladder, dust a shelf and carry three boxes of books. At the end, Theo makes tea and explains, far too seriously, why the alphabet is a great achievement.',
    helpRewardEffects: [grant(ITEM.paper, 1), rel(1, 1, 0)],
    rumour:
      'Theo leans in, then leans back, then leans in again. “The abandoned farmhouse,” he whispers. “Someone ordered twelve books to be delivered there. They paid in advance. Nobody has collected them. That was four months ago.”',
    rumourKeep: '“Thank you,” Theo says, and looks genuinely relieved. “I know it is only a book order. It just did not sit right.”',
    rumourSpread: 'Theo hears you have been telling people about the farmhouse order. His shoulders come down in the way that means he has decided to be disappointed rather than upset.',
    flirt: 'Theo is suddenly extremely interested in a shelf that is exactly at eye level. “You are doing that on purpose,” he says to the shelf.',
    flirtWarm: 'He finally looks at you. “I am not good with people. But I think I could be good with you.” He goes red. “That was a lot. I am sorry. Do not answer now.”',
    special:
      '“My father,” Theo says, and stops. Starts again. “He thought books were a waste. When I bought this shop he did not speak to me for a year. Then he died. And it turns out the whole time he had been keeping every newspaper review of the shop.”',
    specialEffects: [grant(ITEM.romanceNovel, 1), rel(0, 3, 1), advanceGoal('bookshop')],
    gift: 'Theo stares at the {gift} as though it might bite him, and then holds it very carefully, like something important.',
    secretFlag: 'secret_twelve_books',
    goalType: 'bookshop',
    giftItemId: ITEM.romanceNovel,
    romanceable: true,
    emotion: 'shy',
  },
  // 7. Clara Bright - botanist, greenhouse, gentle obsession.
  {
    npcId: NPC.claraBright,
    root: 'Clara is bent over a row of seedlings with a hand lens. “{player}. Look at this. Look at it. The {season} hardly matters in here, but this one is trying anyway.”',
    soaked:
      'Clara looks up, alarmed. “You are going to catch something terrible. Take off your coat. Here, this bench - no, this one, it is warm from the glass.”',
    rainy:
      '“Rain!” Clara presses her palm to the greenhouse glass. “It is not rain in here. It is exactly what I want it to be. That is the whole trick of a greenhouse.”',
    night:
      'Clara walks the greenhouse at night with a lantern, checking leaves. “Some flowers only bother at night,” she says. “It is the only romantic thing about botany.”',
    warm:
      'There is a small potted plant on the bench with a ribbon around it. “I grew it from the seed you liked,” Clara says, not quite looking at you. “Do not make it a big thing.”',
    afterSecret: 'Clara taps her wedding ring finger, then stops herself. “You did not make it strange,” she says. “Thank you for that.”',
    greetAcquaintance: 'Clara emerges from the leaves, hair full of wisps. “Hello. I am in the middle of an experiment. I will still talk. I will just also be looking at this plant.”',
    greetFriend: '“Good, you are here.” Clara points at a sickly fern. “I need someone to agree with me that the soil is the problem, not me.”',
    greetDating: 'Clara’s face does something complicated and delighted. “You are early,” she says. “I have not finished deciding what to say. Say something first.”',
    greetCold:
      'Clara keeps her hands in the soil. “I have nothing to say to that,” she says quietly. “The plants are more forgiving.”',
    greetAwkward: 'Clara looks at you, then at her seedlings. “I do not know where to put this,” she says. “I am sorry. That is not very useful.”',
    chat: 'She explains the difference between a mutation and a fault, and why she keeps the sad plants alive anyway. You understand maybe half of it. She does not mind.',
    chatAlt: 'Clara talks about the botanical name for the common nettle for nine minutes without pausing, then apologises for talking for nine minutes.',
    chatDeep: '“Plants do not lie,” Clara says. “If a leaf is dying you can find out why. People do not give you that courtesy. I have had to learn to live with that.”',
    dream: '“A seed bank,” Clara says at once. “Not just pretty flowers. The old varieties. The ones nobody plants any more because they are ugly or slow. I would keep them all.”',
    work: 'Clara shows you the propagation trays, the sick shelf, and a sunflower that has become unreasonably competitive. “The sunflower is winning,” she says. “It knows it is winning.”',
    workThanks: '“That is the nicest thing anyone has said about the glasshouse,” Clara says. “People usually say it is warm.”',
    shopLabel: 'Buy a packet of lavender seed (£2.40).',
    shopItemId: ITEM.lavenderSeed,
    shopPrice: 240,
    shopSuccess: 'She measures the seeds onto the paper with tweezers. “That is a good variety. Do not plant it in the shade. It will sulk.”',
    workHelpReply: 'You lift sacks of compost and hold a splint steady while Clara grafts. She works quickly and says thank you three times, each quieter than the last.',
    helpRewardEffects: [grant(ITEM.compost, 1), advanceGoal('greenhouse')],
    rumour:
      'Clara locks the greenhouse door behind you. “The hidden garden,” she says. “I know it is there. I have seen the trees from the ridge. There are planted species that nobody should be growing in this climate. That is not wild, {player}. That is somebody.”',
    rumourKeep: '“Thank you,” Clara says, and the tension leaves her shoulders. “I am not brave about that place. I do not know why.”',
    rumourSpread: 'Clara hears the greenhouse rumour in town and closes up early that day. The next time you come, there is a sick plant on the front bench that she says she cannot bear to look at.',
    flirt: 'Clara realises what she has been staring at and turns pink from the collar up. “I am observing,” she says. “It is my profession.”',
    flirtWarm: 'She reaches across the bench and takes your hand, then looks down at it like she has found a new species. “Fascinating,” she says, and means you.',
    special:
      '“I was married,” Clara says at last. “Her name was June. She died in the spring, four years ago. I kept the greenhouse because I did not know what else to do with the mornings.” She wipes her hands. “I am telling you because you should know.”',
    specialEffects: [grant(ITEM.herbSeed, 1), rel(0, 3, 1)],
    gift: 'Clara looks at the {gift} and then at you. “You have a good instinct for these things,” she says, and her voice is not quite steady.',
    secretFlag: 'secret_hidden_garden_species',
    goalType: 'greenhouse',
    giftItemId: ITEM.wildHerb,
    romanceable: true,
    emotion: 'happy',
  },
  // 8. Finn Holloway - fisherman, patient, river-worn.
  {
    npcId: NPC.finnHolloway,
    root: 'Finn is mending a net on the riverbank, slow as the water. “{player}. Sit a while. The fish are not being cooperative and the {weather} is doing something to my knees.”',
    soaked:
      'Finn looks at you, at the river, back at you. “You know there is a whole village to be wet in,” he says mildly, and shifts over so you are out of the drizzle.',
    rainy:
      '“Fish bite better in rain,” Finn says. “People think it is a fisherman’s lie. It is not. They come up because the surface is interesting. Everything wants a bit of company.”',
    night:
      'The river at night is all sound and no edge. Finn is a shape on the bank. “Quiet,” he says. “You will scare the fish. Sit down and be quiet with me.”',
    warm:
      'Finn has already left you the good spot on the bank. “You are here,” he says. “That is the whole report. The fish are incidental.”',
    afterSecret: 'Finn nods once, slow and serious. “A thing told to a fisherman gets buried at the bottom of the river,” he says. “You are not a fisherman. You kept it anyway.”',
    greetAcquaintance: 'Finn raises the net in greeting. “Fine morning. The water is cold. The fish are lying. The usual.”',
    greetFriend: '“Ah, there you are.” Finn is not a man who beams, but he comes close. “Sit. I have brought two cups and no good advice.”',
    greetDating: 'Finn reels in a line that is going nowhere and sets the rod down. “I have been thinking about you all morning,” he says. “It is a very inefficient way to fish.”',
    greetCold:
      'Finn looks at the water and says, “Best spot is downriver today.” He is lying. It is the worst spot on the river.',
    greetAwkward: 'Finn rethreads a line that does not need rethreading. “I do not know how to do this part,” he says. “So I am going to fish.”',
    chat: 'He talks about the river as if it were a friend with bad habits: the pike that runs the weir, the shoal that shows up every May, the eel that has been caught four times and named twice.',
    chatAlt: 'Finn tells you about the flood that came up to the church steps and the boar that swam down the high street, and you can never quite tell which parts he is joking about.',
    chatDeep: '“I am not good with people,” Finn says. “The river does not need conversation. I have to talk to it in other ways. It took me a long time to work out that people need words.”',
    dream: '“A boat,” Finn says. “Not a big one. Just something I could take out on the water when it gets too loud in my head. I have never been good at being on land for long.”',
    work: 'Finn shows you the box of flies he tied himself, the tin of weights, and the hat that is more patch than hat. “You learn the water and the water teaches you the rest.”',
    workThanks: 'Finn is quiet for a moment. “Thank you,” he says, and it sounds heavier than two words should.',
    shopLabel: 'Buy the trout he caught this morning (£4.20).',
    shopItemId: ITEM.fishTrout,
    shopPrice: 420,
    shopSuccess: 'He wraps it in a wet cloth without ceremony. “Cook it today. Do not freeze it. A frozen fish is a wasted fish.”',
    workHelpReply: 'You haul the net, sort the catch by size and muck out the boat while Finn works beside you. He talks more in that hour than he does in a normal week.',
    helpRewardEffects: [grant(ITEM.fishPerch, 1), advanceGoal('river')],
    rumour:
      'Finn is quiet for a long time. “There is something in the lake,” he says. “Not a fish. Too big. It does not move like anything that has to breathe air. I have seen it twice, years apart, and both times I was not drinking.”',
    rumourKeep: '“Hm,” Finn says, which from him is a speech. “Good.”',
    rumourSpread: 'By evening the lake has a monster in it, according to three separate drunks. Finn hears the story and moves his spot downriver without telling you where.',
    flirt: 'Finn looks at you for a beat longer than the river seems to allow. “You are distracting,” he says, and does not sound upset about it.',
    flirtWarm: 'He takes your hand, palm-up, and looks at it as if reading the weather. “Well,” he says at last. “I have never been much good at being alone. I have just been used to it.”',
    special:
      '“My brother drowned,” Finn says, flat as water. “In this river. Sixteen years old. I was the one who found him.” He ties off a knot. “I fish here because I am not going to be afraid of the place that took him as well.”',
    specialEffects: [grant(ITEM.messageBottle, 1), rel(0, 3, 1), advanceGoal('river')],
    gift: 'Finn holds the {gift} for a long moment. “I am not used to things being given to me,” he says. “I will keep it somewhere dry.”',
    secretFlag: 'secret_lake_creature',
    goalType: 'river',
    giftItemId: ITEM.messageBottle,
    romanceable: true,
    emotion: 'neutral',
  },
  // 9. Ada Quinn - farmer, practical, hands like a good pair of gloves.
  {
    npcId: NPC.adaQuinn,
    root: 'Ada is hauling a sack that weighs more than she does. “{player}. Good. Grab the other end. The {season} waits for nobody, and neither do I.”',
    soaked:
      'Ada looks at the sky, then at you. “You are going to rust,” she says. “Barn. Now. I will make tea and you will not argue, because I have a pitchfork.”',
    rainy:
      '“Rain is free water,” Ada says, tipping her hat. “My grandfather called it a poor farmer’s luck. He was wrong. It is a poor farmer’s payday, and we are all poor farmers.”',
    night:
      'Ada is still out with a torch, walking the fence line. “Two posts down,” she says. “If I leave it they will push through by morning. Animals are exactly as stupid as they are clever.”',
    warm:
      'Ada saves the better tools for you. “You do not flinch when it gets hard,” she says. “I have known people twenty years who flinch. That is worth something out here.”',
    afterSecret: 'Ada nods at you from the top field. “You kept your mouth shut,” she says. “That is the highest praise a farmer has. Do not expect it again this year.”',
    greetAcquaintance: 'Ada looks up from the root vegetables. “You are here. There is work. Would you like a cup of tea first? Wrong - tea after.”',
    greetFriend: '“Good,” Ada says, and thrusts a crate at you. “Cabbages. Take them to the gate. Then tea. Then we will talk and you will not have to carry anything.”',
    greetDating: 'Ada pushes her hat back and actually looks at you. “Well. Here you are,” she says. “I was going to be sensible today. Seems unlikely now.”',
    greetCold:
      'Ada does not stop working. “Gate is that way,” she says. “Mind the hens.”',
    greetAwkward: 'Ada hands you a bucket without meeting your eye. “Need this filling,” she says. “Thought you might want something to do with your hands.”',
    chat: 'Ada talks about the market prices the way other people talk about the weather: turnips down, potatoes steady, strawberries outrageous because three people bought them all on a whim.',
    chatAlt: 'She shows you the new pig and tells you, with a straight face, that it is the finest animal in the county and also that it bit the postman.',
    chatDeep: '“Farming is gambling,” Ada says, “except the odds are the weather and the weather is not on your side. I do not do it for the money. I do it because I am good at it, and being good at something is worth a great deal.”',
    dream: '“A proper farm,” Ada says. “Not this rented ground. My own fields, my own barn, my name on the gate. So that when I am dead, someone has to say ‘the Quinn farm’ and know who that was.”',
    work: 'Ada shows you the rotation plan, the seed order and the greenhouse she is still paying off. “That glasshouse has made more money than the rest of the farm put together. I hate it. I respect it.”',
    workThanks: 'Ada snorts. “Flattery will not get you out of work,” she says, and then, quieter, “but I will remember it.”',
    shopLabel: 'Buy a turnip and a chat about soil (£0.90).',
    shopItemId: ITEM.turnip,
    shopPrice: 90,
    shopSuccess: 'She weighs it in her hand. “That is a good turnip,” Ada says. “Do not roast it. We are not animals. Mash it with butter.”',
    workHelpReply: 'You muck out, mend a fence and carry feed. Ada works alongside you without a word of complaint, and by the end you understand why people leave the city for this.',
    helpRewardEffects: [grant(ITEM.potato, 2), advanceGoal('farm')],
    rumour:
      'Ada kicks a clod of soil. “Something has been taking from the top field at night,” she says. “Not animals. Baskets are left in the rows. I have not called the constable. It is bread. Who steals bread from a farm that has bread?”',
    rumourKeep: '“Good,” Ada says, and slaps your shoulder hard enough to stagger you. “Come by at harvest. I will feed you properly.”',
    rumourSpread: 'Ada hears the story in the market, with additions. She is not angry. She is polite, which is worse, and the gate is shut the next time you call.',
    community:
      'Ada rests her elbows on the gate. “The town talks about improvements but nobody wants to pay for them. If you can get a proposal past the council, the farmers will back anything that actually gets built.”',
    special:
      '“I lost a child in the winter of the bad flu,” Ada says, and keeps working, because that is how she says things. “He was seven. He loved the lambs.” She straightens. “I have made my peace. But I do not want it forgotten, and I do not say it to most people.”',
    specialEffects: [grant(ITEM.pumpkin, 1), rel(0, 3, 1), advanceGoal('farm')],
    gift: 'Ada wipes her hands before she takes the {gift}, and then she puts it in her coat, close to her, and says nothing at all.',
    secretFlag: 'secret_top_field_bread',
    goalType: 'farm',
    giftItemId: ITEM.pumpkin,
    romanceable: false,
    emotion: 'happy',
  },
  // 10. Rufus Marsh - warehouse keeper, gruff, secretly fair.
  {
    npcId: NPC.rufusMarsh,
    root: 'Rufus looks up from a ledger with the expression of a man who has never been pleased to see anyone. “{player}. The warehouse is not a social club. Say your business.”',
    soaked:
      'Rufus stares at you dripping on his floor. “...You are making a mess,” he says, and then, before you can turn round, “There is a towel. Behind the door. Do not tell anyone I have a towel.”',
    rainy:
      '“Rain,” Rufus says. “Good. Less traffic. The crates can breathe.” He does not offer you a seat.',
    night:
      'The warehouse is lamp-lit, and Rufus is still in it. “Warehouses do not sleep,” he says, as though that explains anything. It does not.',
    warm:
      'Rufus slides a parcel across the counter. “Came in for you. Nothing important.” It is wrapped. It is the first thing he has ever given you.',
    afterSecret: 'Rufus does not look up from the ledger. “The basement,” he says. “Forget you saw it. And thank you.” He uses the till to underline the thank-you, badly.',
    greetAcquaintance: 'Rufus sighs. “What do you want now,” he says, which is his hello.',
    greetFriend: '“Oh. It is you.” Rufus closes the ledger. “Well. Sit down, then, if you must. Do not touch the tall stack.”',
    greetDating: 'Rufus goes very still. “You are here,” he says, as if confirming a difficult fact. “...I got the tea out.”',
    greetCold: 'Rufus does not look up. “No,” he says, before you speak.',
    greetAwkward: 'Rufus turns a page he has already turned. “You are standing on the loading line,” he says. “But you can stay.”',
    chat: 'Rufus complains about the state of the deliveries, the honesty of the suppliers and the general decline of every standard he can name. He is, you realise, enjoying himself.',
    chatAlt: 'He tells you about the night the warehouse roof leaked and he moved six hundred crates alone, and expects no praise, and is annoyed when he gets some.',
    chatDeep: '“I like things where they belong,” Rufus says. “Everything labelled. Everything in its place. You would not think it was so rare until you met people.”',
    dream: '“I would run the whole depot,” Rufus says. “Not the warehouse. The depot. Every crate in this county. I would have it all in order by Christmas.” He looks almost cheerful about it.',
    work: 'Rufus shows you the ledger, the column that cannot balance, and the ancient system of hand-written dockets he will not replace because the new one is “an insult to shelves.”',
    workThanks: 'Rufus makes a noise like a kettle. “That is not - do not make me say it.” He does not make you say it.',
    shopLabel: 'Buy a bundle of seasoned wood (£2.00).',
    shopItemId: ITEM.wood,
    shopPrice: 200,
    shopSuccess: 'He weighs it himself, then adds two more logs without comment. “Burning,” he says. “Not building. Someone always builds badly with this wood.”',
    workHelpReply: 'You move crates, check dockets and find the pattern in the ledger that Rufus has been staring at for three days. He says nothing, then nods once, which is the loudest approval he owns.',
    helpRewardEffects: [grant(ITEM.plank, 1), rel(1, 1, 0)],
    rumour:
      'Rufus checks the back door twice. “There is a crate that has never been logged,” he says. “It has been here since before I started. I am not allowed to open it. I asked twice. I am not asking again.”',
    rumourKeep: '“Hm.” Rufus straightens his ledger. “You are all right,” he says. Coming from him, it is a parade.',
    rumourSpread: 'Rufus hears that the warehouse has a secret crate and goes very pale and then very angry. The loading line has your name on it the next day, in chalk. It is not a joke.',
    community:
      'Rufus taps the ledger. “This town runs on habit and half-measures. Any project with a proper plan and a proper budget, I will sign for. Anything with a ribbon on it, I will not.”',
    special:
      '“The town gave me this job,” Rufus says, “when nobody else would have me. I was not always - I lost everything, before. The warehouse gave me something to put in order.” He clears his throat. “I would not tell this to the town.”',
    specialEffects: [grant(ITEM.oldCoin, 1), rel(0, 3, 0), advanceGoal('warehouse')],
    gift: 'Rufus looks at the {gift}, then at the door, then at you. “Nobody gives me things,” he says. He puts it in his top pocket, flat, as though filing it.',
    secretFlag: 'secret_unlogged_crate',
    goalType: 'warehouse',
    giftItemId: ITEM.oldCoin,
    romanceable: false,
    emotion: 'angry',
  },
  // 11. Penelope Vance - museum curator, precise, quietly passionate.
  {
    npcId: NPC.penelopeVance,
    root: 'Penelope is adjusting a display case lid with a small spatula. “{player}. Do not lean on the case. I meant that. Do sit, though. The {season} is a difficult one for the exhibits.”',
    soaked:
      'Penelope comes out from behind the case with a board and a cloth. “You are dripping on the floor of a museum,” she says. “Stand there. No, there. I will be a moment.”',
    rainy:
      '“Rain keeps people indoors and indoors brings them to museums,” Penelope says. “I am not supposed to say that. It sounds mercenary. It is true.”',
    night:
      'Penelope is here too late, and the gallery lights are dimmed. “Museums are better at night,” she says. “You can hear them think.”',
    warm:
      'Penelope has put your favourite exhibit out, which is against at least two rules. “Do not tell the board,” she says. “I have been in enough trouble this year.”',
    afterSecret: 'Penelope inclines her head. “You have a curator’s instinct for what matters,” she says. “Which is stranger than it sounds. Most people only see the glass.”',
    greetAcquaintance: 'Penelope looks up from a label. “Hello. I am reading about a jug. It is the most interesting jug in the county. You will have to take my word for it.”',
    greetFriend: '“Good - yes, come here.” Penelope beckons you over to a case. “I need a second opinion about the eyes,” she says. “Do not ask yet. Look first.”',
    greetDating: 'Penelope unhooks her glasses, which she never does. “Hello,” she says, and for a moment there is no museum at all.',
    greetCold:
      'Penelope keeps working. “The museum closes in twenty minutes,” she says. It is closed.',
    greetAwkward: 'Penelope straightens a label that does not need straightening. “I have been thinking about a better way to say what I said,” she says. “I have not found one.”',
    chat: 'Penelope tells you about the fish fossil she is negotiating for, the donor who wants it displayed upside down, and the ethics of accepting money from someone you cannot stand.',
    chatAlt: 'She explains how to spot a fake coin: weight, wear, and a specific kind of greed in the eyes of the seller. She says it is all in the wrists.',
    chatDeep: '“A museum is a promise,” Penelope says. “That we will still care about these things after the people who cared first are gone. I was not joking about the jug.”',
    dream: '“A proper collection,” she says. “Not just the town’s cast-offs. A real museum, with real funding, that children remember. That is all. That is the whole ambition.”',
    work: 'Penelope shows you how to handle a fragile brooch: two hands, cotton gloves, no sudden movements. “If you drop it,” she says, “do not try to catch it. I am serious. Your instinct will be wrong.”',
    workThanks: 'Penelope pauses. “Thank you,” she says with great formality, and then, much less formally, “I am not used to people noticing.”',
    shopLabel: 'Buy the museum guide (£3.00).',
    shopItemId: ITEM.museumGuide,
    shopPrice: 300,
    shopSuccess: 'She signs the guide in small, precise handwriting. “Page six is wrong,” she says. “The board will not let me correct it. Consider it a collector’s item.”',
    workHelpReply: 'You catalogue a whole shelf of unlabelled finds with Penelope. She corrects you six times, thanks you nine, and by the end you know what a hallmarked spoon is supposed to look like.',
    helpRewardEffects: [grant(ITEM.oldClue, 1), advanceGoal('museum')],
    rumour:
      'Penelope locks the office door. “There is a piece in the basement that is not in any catalogue,” she says. “I found it in a box labelled ‘misc’. It is old, {player}. Older than the town. I am not sure it should be here at all.”',
    rumourKeep: '“Thank you,” Penelope says, and lets out a breath she has been holding for weeks. “The board will never hear it from me, or from you, and that is the whole thing, is it not?”',
    rumourSpread: 'Penelope hears the basement story making the rounds and becomes coolly, horribly professional. Every label in the room is suddenly a warning about confidentiality.',
    community:
      'Penelope gestures at the gallery. “Culture is the first thing a town stops paying for and the last thing it misses. If you ever want to argue the case for something lasting, I will stand up with you.”',
    special:
      '“I lost my position in the city,” Penelope says. “I was right, and the board was wrong, and I said so in a meeting. This museum took me in when nobody else would. I have been grateful every day since, and I have never once said so out loud.”',
    specialEffects: [grant(ITEM.fossil, 1), rel(0, 2, 1), advanceGoal('museum')],
    gift: 'Penelope takes the {gift}, examines it for provenance out of pure habit, then catches herself and simply says, “Oh. That is lovely.”',
    secretFlag: 'secret_basement_piece',
    goalType: 'museum',
    giftItemId: ITEM.fossil,
    romanceable: false,
    emotion: 'neutral',
  },
  // 12. Jasper Kim - barista and musician, all warmth and noise.
  {
    npcId: NPC.jasperKim,
    root: 'Jasper is behind the counter, humming something that does not exist yet. “{player}! Perfect. I need a human opinion that is not my own. The {weather} has made me reckless.”',
    soaked:
      'Jasper takes your arm and steers you inside. “You are a disaster,” he says fondly. “Sit. I am making you something hot and you are going to let me.”',
    rainy:
      '“Rain!” Jasper grins at the window. “The best song weather. Everything sounds sadder and better. I have already written two bad ones today.”',
    night:
      'The cafe is closed and Jasper is playing to an audience of one chair. “You caught me,” he says. “It is not finished. Do not judge it. Judge the chorus, maybe.”',
    warm:
      'Jasper plays your favourite, badly and then well, and refuses to be embarrassed about the badly part. “I only ever play it when you are here,” he says. “That is a confession, by the way.”',
    afterSecret: 'Jasper lifts his cup to you across the cafe. “You keep my secrets better than I do,” he says. “That is a rare sort of friend.”',
    greetAcquaintance: '“Hey, hey.” Jasper waves with a cloth. “Sit down, I will be two minutes. Do not order the special. The special is me trying something.”',
    greetFriend: '“There you are!” Jasper pulls out the chair next to him. “I have been saving this seat all morning and it has been exhausting.”',
    greetDating: 'Jasper’s whole face opens up. “You,” he says, delighted. “Sit. No, here. I am going to play you something and you are going to be kind about it.”',
    greetCold:
      'Jasper keeps wiping the same clean table. “I will get to you in a minute,” he says, and does not.',
    greetAwkward: 'Jasper stops mid-tune. “Ah,” he says. “I have been practising that for when I saw you, and now I have forgotten it.”',
    chat: 'Jasper talks about the band, the one he joined and left, and the song he is writing for a wedding where the couple have, apparently, unreasonable opinions about the bridge.',
    chatAlt: 'He invents a song about the postman on the spot, with a verse about his knee, and it is genuinely good. He is as surprised as you are.',
    chatDeep: '“I am not loud because I am happy,” Jasper says, stirring nothing. “I am loud because otherwise I am very quiet, and the quiet is not always kind to me.”',
    dream: '“A stage,” Jasper says. “A real one. Not a corner of the cafe. Somewhere that people come to hear things they have never heard. And I would not have to choose between coffee and music any more.”',
    work: 'Jasper shows you the espresso machine he has named, the chalkboard he redraws every morning and the tip jar that is mostly buttons. “It is a small theatre,” he says. “Everything is a small theatre.”',
    workThanks: '“Ah, you are going to make me blush,” Jasper says, going pink. “Stop it. Do not stop. Hm. Mixed feelings.”',
    shopLabel: 'Buy the house special (£2.30).',
    shopItemId: ITEM.coffeeCup,
    shopPrice: 230,
    shopSuccess: 'He makes it with a flourish and a running commentary. “That is not on the menu and never will be,” he says. “Consider yourself a limited edition.”',
    workHelpReply: 'You work the counter with Jasper through the lunch rush. He sings, you burn a panini, he saves it, and by the end the whole cafe is in on the joke.',
    helpRewardEffects: [grant(ITEM.coffeeBeans, 1), advanceGoal('music')],
    rumour:
      'Jasper leans across the counter, lowering his voice for the first time in living memory. “The old record shop closed because of a fire,” he says. “There is a box of master tapes in my flat. The owner left them with me. That was three years ago and I have not listened to them.”',
    rumourKeep: 'Jasper spreads his hands. “You are a good one,” he says. “If I ever make it, you get a verse. A good one.”',
    rumourSpread: 'Jasper hears the tapes are the talk of the cafe and his smile goes narrow. “That was mine,” he says quietly. “It was not a story. It was a thing I told you.”',
    flirt: 'Jasper plays a chord that is entirely the wrong moment and does not notice. “Sorry,” he says. “I was thinking about something. Someone. You.”',
    flirtWarm: 'He sets the guitar down. “I write songs about everything,” Jasper says. “I have not written one about you yet, because I cannot find a rhyme that is good enough. That is where we are.”',
    special:
      '“My family wanted me to be a doctor,” Jasper says, tuning a string that will not stay tuned. “I got into medical school. I did not go. My mother did not speak to me for two years.” He shrugs, and it is not a light shrug. “She came to a gig last winter. Stood at the back. Clapped. We have not talked about it.”',
    specialEffects: [grant(ITEM.musicBox, 1), rel(0, 3, 1), advanceGoal('music')],
    gift: 'Jasper holds the {gift}, then puts it on the counter, then picks it up again. “You are going to make me feel things in my own cafe,” he says. “Unacceptable. Thank you.”',
    secretFlag: 'secret_master_tapes',
    goalType: 'music',
    giftItemId: ITEM.musicBox,
    romanceable: true,
    emotion: 'happy',
  },
  // 13. Edmund Hale - community chair, careful, carries the town.
  {
    npcId: NPC.edmundHale,
    root: 'Edmund is pinning a notice to the board with more care than a notice strictly needs. “{player}. Good. I wanted a word about the {season} meeting. No - not official. Mostly.”',
    soaked:
      'Edmund produces an umbrella from somewhere, the way he produces things. “You will catch your death standing there,” he says. “Walk with me. I have several things to say and one of them is welcome.”',
    rainy:
      '“Rain thins the meeting,” Edmund says, not unhappily. “But we have the hall, and a hall is better than a field when the sky is being difficult.”',
    night:
      'Edmund is taking down the notice board by lamplight. “The town does not tidy itself,” he says. “Though I have asked it nicely several times.”',
    warm:
      'Edmund looks over your proposed notice and does not correct a single word. “That is well put,” he says. “I will have it printed.” From him, this is a standing ovation.',
    afterSecret: 'Edmund shakes your hand for slightly too long. “The town needs more people who listen,” he says. “It might be you. Do not let it go to your head.”',
    greetAcquaintance: 'Edmund nods precisely. “Morning. The board is full, the roof needs work, and the clerk has vanished again. The usual.”',
    greetFriend: '“Ah, good. Come here.” Edmund moves a pin. “Tell me what you think of this. You will not be diplomatic, which is exactly why I am asking.”',
    greetDating: 'Edmund catches himself smiling in public and adjusts his collar. “I have been looking forward to seeing you,” he says. “I have had this whole walk planned.”',
    greetCold:
      'Edmund carries on with the notice board. “I am busy,” he says. “The town is always busy. That is what makes it good.”',
    greetAwkward: 'Edmund rubs the bridge of his nose. “I have been trying to draft an apology,” he admits. “It keeps coming out as an agenda item.”',
    chat: 'Edmund talks about the parish council the way other people talk about warfare: long wars, small atrocities, occasional victories over the bins.',
    chatAlt: 'He tells you about the meeting where the issue of the car park was resolved by a motion, an amendment and, at one point, a dropped sandwich.',
    chatDeep: '“I am not a leader,” Edmund says. “I am the man who remembers the agenda. It is not glamorous. But there is nobody else, and every year I think, this is the year I stop.” He smiles. “I have not stopped.”',
    dream: '“A town that still works when I am gone,” Edmund says immediately. “Not because I built it. Because enough people wanted it. That is the dream. It is a bit administrative.”',
    work: 'Edmund shows you the notice board, the minutes, and the long list of things waiting to be approved. “The trick,” he says, “is to make people believe the idea is theirs. It very often is.”',
    workThanks: 'Edmund clears his throat. “That is - yes. Thank you. I will put that in the minutes.” He will not. He will simply remember it.',
    shopLabel: 'Buy a copy of the town almanac (£2.50).',
    shopItemId: ITEM.townAlmanac,
    shopPrice: 250,
    shopSuccess: 'He hands it over with the air of a man distributing scripture. “Page four lists every shop. Some of them have closed. I have not had the heart to reprint.”',
    workHelpReply: 'You pin notices, carry the crate of minutes and sit through a sub-committee with Edmund. He runs it like a man defusing something, and by the end you understand why nothing gets done quickly.',
    helpRewardEffects: [grant(ITEM.paper, 2), gainInfluence(1)],
    rumour:
      'Edmund checks that the hall door is shut. “The proposal fund,” he says. “There is money in it. Not much. It has been sitting there for two years because nobody will take the first step. I cannot propose it myself - it would look like I am building a monument to my own tenure.”',
    rumourKeep: '“Good,” Edmund says, and his shoulders relax a fraction. “It has been on my mind all week. That is a weight off.”',
    rumourSpread: 'Edmund hears the fund mentioned in the street and spends the rest of the week being scrupulously, painfully neutral at you.',
    community:
      'Edmund checks nobody is listening. “The town will not vote for anything it cannot picture. Bring it to the board with a cost, a place and a reason, and I will make sure it gets a fair hearing. That is all I can promise.”',
    special:
      '“My wife died eight years ago,” Edmund says, adjusting a pin that does not need adjusting. “She was the one who got things done. I started doing the bulletin because I did not know what to do with the evenings.” He looks at the board. “And now it is me.”',
    specialEffects: [rel(0, 2, 1), gainInfluence(2), setFlag('edmund_trust_confessed')],
    gift: 'Edmund looks at the {gift} for a long moment. “You did not have to,” he says. “That is exactly the sort of thing that works on me.”',
    secretFlag: 'secret_proposal_fund',
    goalType: 'town',
    giftItemId: ITEM.townAlmanac,
    romanceable: false,
    emotion: 'neutral',
  },
  // 14. Nina Okoye - city office worker, sharp, ambitious, a little lonely.
  {
    npcId: NPC.ninaOkoye,
    root: 'Nina is between the cafe and the station, phone in one hand, coffee in the other. “{player}. Walk with me? If I stop, the day catches up.”',
    soaked:
      'Nina stops dead. “You came out in this?” She wrestles her umbrella over both of you. “Right. My flat is ten minutes away and I am not having you dissolve on a Tuesday.”',
    rainy:
      '“Rain in the city is different,” Nina says, watching it hit the pavement and run. “It does not touch the ground. It just makes everything look six per cent worse.”',
    night:
      'Nina is on the platform with a folder under her arm. “Late train,” she says. “Again. The city does not stop and neither do the emails.”',
    warm:
      'Nina saves you the seat in the corner of the cafe. “Five minutes,” she says. “That is all I have. It is also the best part of my day, so do not waste it.”',
    afterSecret: 'Nina looks at you over the top of her cup. “You did not put it in the group chat,” she says. “That is the most romantic thing anyone has done for me in a while.”',
    greetAcquaintance: 'Nina checks her watch and then, deliberately, stops checking it. “Two minutes,” she says. “Go.”',
    greetFriend: '“Oh, you are here,” Nina says, relieved, and then immediately embarrassed about being relieved. “Sit. I am not working, I am having a break, I am a person who takes breaks.”',
    greetDating: 'Nina puts her phone face-down, which is her version of a bouquet. “There you are,” she says. “I have the whole afternoon. Well. An hour. Do not tell anyone.”',
    greetCold:
      'Nina picks up her empty cup. “I have to be somewhere,” she says. She does not.',
    greetAwkward: 'Nina is very busy with a napkin. “I may have been unfair to you,” she says. “I have been told I can be. Not by you.”',
    chat: 'Nina complains about the open-plan office with the fluency of a professional: the meetings that could have been emails, the emails that could have been silence.',
    chatAlt: 'She tells you about the pitch she delivered to a room of eleven men in which she was the only person with a plan, and the way nobody remembered it was her idea.',
    chatDeep: '“I do not hate the city,” Nina says. “But some days I walk through it and it feels like a place I am auditioning for. I have not decided whether I want the part.”',
    dream: '“My own consultancy,” Nina says. “Small. Good clients. Home by seven.” She pauses. “And a garden. A stupid little garden. I have never had one.”',
    work: 'Nina shows you the schedule on her phone: meetings, deadlines, one slot on Friday that she has left deliberately blank. “That is the most important part,” she says. “The blank one.”',
    workThanks: 'Nina looks up sharply. “That is a good take,” she says. “Do not tell my manager. She thinks I have no time for feedback.”',
    shopLabel: 'Buy her a hot chocolate from the kiosk (£2.60).',
    shopItemId: ITEM.hotChocolate,
    shopPrice: 260,
    shopSuccess: 'She takes the cup with both hands. “You are getting good at this,” Nina says. “I am suspicious of how good you are getting at this.”',
    workHelpReply: 'You read a proposal over her shoulder and find the flaw in the numbers. Nina stares at you, then at the page, then back at you. “You just saved me a fortnight,” she says.',
    helpRewardEffects: [grant(ITEM.ink, 1), gainInfluence(1)],
    rumour:
      'Nina checks over her shoulder. “My firm is buying land on the edge of the village,” she says. “Nobody has told the council yet. It is not a secret, exactly. It is just not public. I am not supposed to know you. Not like this.”',
    rumourKeep: '“You are not going to say anything,” Nina says, relieved, and then, carefully, “I am telling you more than I should. I noticed that too.”',
    rumourSpread: 'Nina hears the land purchase discussed on the train and does not call you for a week. When she does, her voice is perfectly polite and entirely empty.',
    flirt: 'Nina catches you looking at her over her coffee and raises one eyebrow. “Careful,” she says. “I am very good at negotiating.”',
    flirtWarm: '“I do not do this,” Nina says. “I do not have time for this. I made time anyway. Do your worst.”',
    special:
      '“I moved here from the city with nothing,” Nina says, stirring her coffee. “I left a life that looked very good from the outside. The village was meant to be a stopgap.” She looks at the square. “I have been in the stopgap for four years now. I do not want to leave. That frightens me.”',
    specialEffects: [grant(ITEM.oldCoin, 1), rel(0, 2, 1), gainInfluence(1)],
    gift: 'Nina turns the {gift} over in her hands. “City people give you things to get something,” she says. “You are either very bad at this or very good at it.”',
    secretFlag: 'secret_land_purchase',
    goalType: 'city',
    giftItemId: ITEM.paintedCard,
    romanceable: true,
    emotion: 'neutral',
  },
];

// ---------------------------------------------------------------------------
// Generic resident tree - shared by all 42 ordinary residents
// ---------------------------------------------------------------------------
function buildResidentTree(): DialogueTree {
  const nodes: Record<string, DialogueNode> = {
    root: {
      id: 'root',
      text: 'They look up from whatever the day has handed them. “Oh - hello. {weather} one, is it not? You are the cigarette everyone keeps mentioning.”',
      emotion: 'neutral',
      variants: [
        { conditions: [seenBefore(false)], text: 'They look you up and down, curious. “You are that cigarette, are you not? The one who moved into the old place. I have heard things.”' },
        { conditions: [moistureMin(0.6)], text: '“You are dripping all over the pavement,” they say, not unkindly. “Does that hurt? For a cigarette, I mean.”' },
        { conditions: [weatherIn('rain', 'storm')], text: '“Terrible weather for it,” they say, nodding at you. “Though I suppose you are the only one in the village who actually gets smaller in the rain.”' },
        { conditions: [hourBetween(22, 5)], text: '“You are out late,” they say, and glance at the dark street. “Mind yourself. Nothing good happens after eleven in this village.”' },
        { conditions: [chanceOf(0.3)], text: 'They are halfway through a thought and startle when they see you. “Sorry. I was somewhere else entirely. Hello, {player}.”' },
      ],
      choices: [
        { id: 'resident_smalltalk', text: 'Ask how they are doing.', next: 'smalltalk' },
        { id: 'resident_weather', text: 'Talk about the weather.', next: 'weathertalk' },
        { id: 'resident_advice', text: 'Ask what they would do in your shoes. Or your filter.', next: 'advice' },
        { id: 'resident_gossip', text: 'Ask what is happening in the village.', conditions: [affinityMin(8)], next: 'gossip' },
        { id: 'resident_rumour', text: 'Ask if they have heard anything interesting lately.', conditions: [affinityMin(20)], next: 'rumour' },
        { id: 'resident_season', text: 'Remark on the season.', next: 'seasonal' },
        { id: 'bye', text: 'Wish them a good day and move on.', next: 'bye' },
      ],
    },
    greet: {
      id: 'greet',
      text: '“Morning,” they say, and then, after a pause, “or afternoon. I have been out here too long either way.”',
      emotion: 'neutral',
      choices: [
        { id: 'resident_smalltalk', text: 'Ask how they are doing.', next: 'smalltalk' },
        { id: 'resident_weather', text: 'Talk about the weather.', next: 'weathertalk' },
        { id: 'bye', text: 'Wish them a good day and move on.', next: 'bye' },
      ],
    },
    greet_friend: {
      id: 'greet_friend',
      text: '“There you are!” They wave you over with actual enthusiasm. “I was saying to my sister just yesterday that we never see enough of you.”',
      emotion: 'happy',
      choices: [
        { id: 'resident_smalltalk', text: 'Ask how they are doing.', next: 'smalltalk' },
        { id: 'resident_weather', text: 'Talk about the weather.', next: 'weathertalk' },
        { id: 'resident_gossip', text: 'Ask what is happening in the village.', conditions: [affinityMin(8)], next: 'gossip' },
        { id: 'resident_rumour', text: 'Ask if they have heard anything interesting lately.', conditions: [affinityMin(20)], next: 'rumour' },
        { id: 'bye', text: 'Wish them a good day and move on.', next: 'bye' },
      ],
    },
    smalltalk: {
      id: 'smalltalk',
      text: 'They tell you about their day - the queue at the post office, the state of their knees, a niece who has opinions about the correct way to hang washing. Ordinary things, offered warmly.',
      emotion: 'happy',
      choices: [
        { id: 'resident_listen', text: 'Actually listen.', once: true, effects: [rel(1, 1, 0), remember('The cigarette listened to their ordinary day as if it mattered. It did.', 18)], next: 'smalltalk_listened' },
        { id: 'resident_reply', text: 'Trade a small story of your own.', effects: [rel(1, 0, 0)], next: 'root' },
        { id: 'bye', text: 'Say goodbye.', next: 'bye' },
      ],
    },
    smalltalk_listened: {
      id: 'smalltalk_listened',
      text: '“You know,” they say, surprised, “you are a good listener for somebody who is mostly paper. Most people just wait for their turn to talk.”',
      emotion: 'happy',
      choices: [{ id: 'back', text: 'Take your leave before it gets sentimental.', next: 'root' }, { id: 'bye', text: 'Say goodbye.', next: 'bye' }],
    },
    weathertalk: {
      id: 'weathertalk',
      text: 'They have the complete weather forecast, a personal opinion about it, and a story about a worse year. {season} brings out the historian in everyone.',
      emotion: 'neutral',
      variants: [
        { conditions: [weatherIn('rain', 'storm')], text: '“Rain like this reminds me of the flood,” they say, with relish. “Nineteen sixty-two. The water came up the lane. My mother floated a tea tray down it.”' },
        { conditions: [weatherIn('snow')], text: '“Snow,” they say, and look at it as if personally offended. “Pretty for a day. Then it is just cold water with ambition.”' },
        { conditions: [weatherIn('clear')], text: '“A day like this,” they say, gesturing at everything, “is why I have never moved. Look at it. You could not buy it.”' },
      ],
      choices: [
        { id: 'resident_weather_agree', text: 'Agree wholeheartedly.', once: true, effects: [rel(1, 0, 0)], next: 'root' },
        { id: 'bye', text: 'Say goodbye.', next: 'bye' },
      ],
    },
    advice: {
      id: 'advice',
      text: 'They consider the question with more gravity than you expected. “For a cigarette, you mean? Keep dry. Keep out of the wind. And do not let the young ones tell you how to live.”',
      emotion: 'neutral',
      variants: [
        { conditions: [moodMin(60)], text: '“You are asking the wrong person for advice,” they say, but they are smiling. “I have made every mistake twice. That makes me an expert, technically.”' },
      ],
      choices: [
        { id: 'resident_advice_thanks', text: 'Thank them for the wisdom.', once: true, effects: [rel(1, 1, 0), remember('The cigarette asked them for advice and took it seriously. Flattering.', 20)], next: 'root' },
        { id: 'bye', text: 'Say goodbye.', next: 'bye' },
      ],
    },
    gossip: {
      id: 'gossip',
      text: 'They lean in. “The baker has been baking at four in the morning again. The florist has a wedding order she will not talk about. And the postman - well. You did not hear it from me, but the postman is in love with somebody in this village.”',
      emotion: 'surprised',
      effects: [setFlag('resident_gossip_heard'), remember('The cigarette listened to the village gossip. Nothing important. Everything interesting.', 16)],
      choices: [
        { id: 'resident_gossip_more', text: 'Ask who the postman is in love with.', once: true, effects: [gainInfluence(1), rel(1, 0, 0)], next: 'gossip_more' },
        { id: 'bye', text: 'Say goodbye.', next: 'bye' },
      ],
    },
    gossip_more: {
      id: 'gossip_more',
      text: '“Nobody knows,” they say, delighted. “That is what makes it good gossip. If we knew, it would just be news.”',
      emotion: 'happy',
      choices: [{ id: 'bye', text: 'Leave the mystery intact.', next: 'bye' }],
    },
    rumour: {
      id: 'rumour',
      text: 'They look around and drop their voice. “They say the old places are not as empty as they look. The farmhouse, the mill, the well behind the church. People see lights. My cousin swears she heard singing in the hidden garden.”',
      emotion: 'shy',
      effects: [setFlag('resident_rumours_heard'), gainInfluence(1), remember('The cigarette traded village rumours. The kind that are mostly true.', 24)],
      choices: [
        { id: 'resident_rumour_question', text: 'Ask what they think is really going on.', once: true, effects: [rel(1, 1, 0)], next: 'rumour_more' },
        { id: 'bye', text: 'Say goodbye.', next: 'bye' },
      ],
    },
    rumour_more: {
      id: 'rumour_more',
      text: '“I think,” they say, “that this village has kept a secret for a very long time, and it is getting tired of it.” They shrug. “Or it is foxes. It is usually foxes.”',
      emotion: 'neutral',
      choices: [{ id: 'bye', text: 'Say goodbye.', next: 'bye' }],
    },
    seasonal: {
      id: 'seasonal',
      text: 'They talk about the {season} with real feeling: what it means for the garden, the market, the light in the evenings, and their own opinion about whether it is the best one.',
      emotion: 'neutral',
      variants: [
        { conditions: [seasonIn('spring')], text: '“Spring,” they say. “Everything coming up and everyone pretending they are not counting the days until summer. I love it. It is all lies and optimism.”' },
        { conditions: [seasonIn('summer')], text: '“Summer,” they say, fanning themselves with a leaflet. “The long evenings make people think they have more time than they do. Dangerous. Lovely, but dangerous.”' },
        { conditions: [seasonIn('autumn')], text: '“Autumn,” they say, with satisfaction. “The best season. I will not be taking questions. Everything smells correct.”' },
        { conditions: [seasonIn('winter')], text: '“Winter,” they say, pulling their coat tight. “Half the village goes to sleep and the other half complains about it. I am in the complaining half. I like the complaining half.”' },
      ],
      choices: [
        { id: 'resident_season_agree', text: 'Agree that it is the best season.', once: true, effects: [rel(1, 0, 0)], next: 'root' },
        { id: 'bye', text: 'Say goodbye.', next: 'bye' },
      ],
    },
    bye: {
      id: 'bye',
      text: 'You leave them to it. The {weather} follows you down the street, and somewhere behind you a gate clicks shut.',
      emotion: 'neutral',
      effects: [endDialogue],
    },
  };
  return {
    id: 'dialogue_resident',
    rootNodeId: 'root',
    nodes,
    greetingByStatus: {
      enemy: 'root',
      rival: 'root',
      ex: 'root',
      partner: 'greet_friend',
      dating: 'greet_friend',
      close_friend: 'greet_friend',
      friend: 'greet_friend',
      acquaintance: 'greet',
      stranger: 'root',
      family: 'greet_friend',
    },
  };
}

// ---------------------------------------------------------------------------
// Optional role fallback trees (shopkeeper / farmer / artist)
// ---------------------------------------------------------------------------
function buildShopkeeperTree(): DialogueTree {
  const nodes: Record<string, DialogueNode> = {
    root: {
      id: 'root',
      text: 'The shopkeeper looks up with the practised warmth of someone who is paid to be pleased to see you. “Afternoon. {weather} enough for you? Let me know if you need anything from the back.”',
      emotion: 'neutral',
      variants: [
        { conditions: [hourBetween(6, 9)], text: 'The shutters are only half up. “Early,” the shopkeeper says. “You are either very keen or very worried. Which is it?”' },
        { conditions: [weatherIn('rain')], text: '“Raining,” the shopkeeper observes. “That will be another hour of mopping the entrance. Buy something and I will forgive you for the puddles.”' },
      ],
      choices: [
        { id: 'shop_browse', text: 'Ask what is good today.', next: 'browse' },
        { id: 'shop_smalltalk', text: 'Make friendly conversation.', next: 'smalltalk' },
        { id: 'bye', text: 'Say goodbye.', next: 'bye' },
      ],
    },
    browse: {
      id: 'browse',
      text: 'They point out the new stock, the reduced shelf and the one thing they cannot shift. “That has been here since spring,” they admit. “I am starting to feel sorry for it.”',
      emotion: 'happy',
      choices: [
        { id: 'shop_buy', text: 'Buy the neglected thing for a few coins.', once: true, effects: [pay(-150), rel(1, 0, 0)], next: 'browse_sold' },
        { id: 'bye', text: 'Say goodbye.', next: 'bye' },
      ],
    },
    browse_sold: {
      id: 'browse_sold',
      text: '“You did not have to do that,” the shopkeeper says, wrapping it carefully. “I will remember it. Not necessarily favourably, but I will remember.”',
      emotion: 'happy',
      choices: [{ id: 'back', text: 'Take your leave.', next: 'root' }, { id: 'bye', text: 'Say goodbye.', next: 'bye' }],
    },
    smalltalk: {
      id: 'smalltalk',
      text: 'They have a view on the council, the roadworks and the price of everything. It is not an original view, but it is delivered with tremendous conviction.',
      emotion: 'neutral',
      choices: [
        { id: 'shop_smalltalk_agree', text: 'Agree with all of it.', once: true, effects: [rel(1, 0, 0)], next: 'root' },
        { id: 'bye', text: 'Say goodbye.', next: 'bye' },
      ],
    },
    bye: {
      id: 'bye',
      text: 'The bell over the door rings as you leave. “Mind the step,” they call after you, “and the weather.”',
      emotion: 'neutral',
      effects: [endDialogue],
    },
  };
  return { id: 'dialogue_shopkeeper', rootNodeId: 'root', nodes };
}

function buildFarmerTree(): DialogueTree {
  const nodes: Record<string, DialogueNode> = {
    root: {
      id: 'root',
      text: 'The farmer straightens up from the fence with a grunt. “You are not from round here,” they say, then squint. “No. You are that cigarette. My apologies. The {season} makes everybody look the same from a distance.”',
      emotion: 'neutral',
      variants: [
        { conditions: [weatherIn('rain')], text: '“Rain,” the farmer says, looking at the sky rather than at you. “Good. Saves me a job. Bad for the road, but the road is not mine.”' },
      ],
      choices: [
        { id: 'farm_work', text: 'Ask how the growing is going.', next: 'work' },
        { id: 'farm_advice', text: 'Ask for advice about the land.', conditions: [trustMin(10)], next: 'advice' },
        { id: 'bye', text: 'Say goodbye.', next: 'bye' },
      ],
    },
    work: {
      id: 'work',
      text: '“Slow,” they say. “And then all at once, and then it is over and I am sat in the kitchen wondering what to do with my hands.”',
      emotion: 'neutral',
      choices: [
        { id: 'farm_thanks', text: 'Thank them for the explanation.', once: true, effects: [rel(1, 1, 0)], next: 'root' },
        { id: 'bye', text: 'Say goodbye.', next: 'bye' },
      ],
    },
    advice: {
      id: 'advice',
      text: '“The land does not care who you are,” they say. “It cares what you do, and it remembers it, and it does not forgive the same mistake twice. That is the whole course.”',
      emotion: 'neutral',
      choices: [
        { id: 'farm_advice_thanks', text: 'Take the advice seriously.', once: true, effects: [rel(1, 1, 0), remember('The cigarette listened to hard-won farming wisdom.', 20)], next: 'root' },
        { id: 'bye', text: 'Say goodbye.', next: 'bye' },
      ],
    },
    bye: {
      id: 'bye',
      text: 'The farmer returns to the fence. Somewhere behind them a dog barks at nothing, twice, and then thinks better of it.',
      emotion: 'neutral',
      effects: [endDialogue],
    },
  };
  return { id: 'dialogue_farmer', rootNodeId: 'root', nodes };
}

function buildArtistTree(): DialogueTree {
  const nodes: Record<string, DialogueNode> = {
    root: {
      id: 'root',
      text: 'The artist regards you like a difficult colour. “Sit down,” they say. “No - stand. Actually, stand there. The light is doing something interesting to your filter.”',
      emotion: 'surprised',
      variants: [
        { conditions: [hourBetween(1, 6)], text: 'The artist is painting in the dark, which they insist is practical. “The shadows are better at this hour,” they say. “So are my ideas.”' },
        { conditions: [moodMin(70)], text: 'The artist is almost cheerful today. “You have caught me in a good mood,” they warn. “Do not get used to it.”' },
      ],
      choices: [
        { id: 'art_portrait', text: 'Ask what they are working on.', next: 'portrait' },
        { id: 'art_critique', text: 'Ask them to be honest about something of yours.', conditions: [affinityMin(15)], next: 'critique' },
        { id: 'bye', text: 'Say goodbye.', next: 'bye' },
      ],
    },
    portrait: {
      id: 'portrait',
      text: '“Something with smoke in it,” they say. “Smoke and ash. Everyone paints flowers. Nobody paints what is left after.”',
      emotion: 'neutral',
      choices: [
        { id: 'art_portrait_interest', text: 'Ask to see it.', once: true, effects: [rel(1, 1, 0), gainInfluence(1)], next: 'portrait_seen' },
        { id: 'bye', text: 'Say goodbye.', next: 'bye' },
      ],
    },
    portrait_seen: {
      id: 'portrait_seen',
      text: 'It is unfinished and better than most finished things. “Do not say it is good,” the artist says, too quickly. “Say what it needs.”',
      emotion: 'shy',
      choices: [{ id: 'back', text: 'Step back and leave them to it.', next: 'root' }, { id: 'bye', text: 'Say goodbye.', next: 'bye' }],
    },
    critique: {
      id: 'critique',
      text: 'They look at what you show them for a very long time. “The good part is here,” they say, tapping a corner. “Throw away the rest. Start again. It will take you a week and be worth it.”',
      emotion: 'neutral',
      choices: [
        { id: 'art_critique_thanks', text: 'Thank them and mean it.', once: true, effects: [rel(1, 1, 0), advanceGoal('art')], next: 'root' },
        { id: 'bye', text: 'Say goodbye.', next: 'bye' },
      ],
    },
    bye: {
      id: 'bye',
      text: 'The artist turns back to the canvas before you are even out of the room. You are, in a way, being painted.',
      emotion: 'neutral',
      effects: [endDialogue],
    },
  };
  return { id: 'dialogue_artist', rootNodeId: 'root', nodes };
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------
export const DIALOGUE_TREES: DialogueTree[] = [
  ...MAJOR_DIALOGUE_CONFIGS.map(buildMajorTree),
  buildResidentTree(),
  buildShopkeeperTree(),
  buildFarmerTree(),
  buildArtistTree(),
];

/** Lookup helper (used by tests and dialogue validation). */
export function getDialogueTreeById(treeId: string): DialogueTree | undefined {
  return DIALOGUE_TREES.find((tree) => tree.id === treeId);
}

/** True when every major NPC id has a dedicated tree. */
export const MAJOR_NPC_DIALOGUE_TREE_IDS: readonly string[] = MAJOR_DIALOGUE_CONFIGS.map((config) => 'dialogue_' + config.npcId);
