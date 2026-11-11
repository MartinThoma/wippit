# Functional Specification: Wippit! (Core Mechanics)

## 1. Coordinate System & Grid Architecture
- **Grid Dimensions:** $N$ columns wide by $M$ rows high (e.g., 6 columns $\times$ 12 rows).
- **Coordinate Space:** $(x, y)$ where $x \in [0, N-1]$ represents columns (left to right) and $y \in [0, M-1]$ represents rows (bottom to top).
- **Cell State:** Each grid cell stores either `null` or a `Block` object.

Block Object Schema:
- `block_id`: string (uuid-v4)
- `color`: string (enum: red, blue, green, yellow, purple)
- `weight`: integer (1 through 9)
- *Note:* Special items (Jokers, Bombs) inherit from this schema with flag properties.

## 2. Core Game Loop State Machine
The game operates on a discrete event-driven state machine:

1. [IDLE / WAITING FOR INPUT] 
   -> (Player moves / drops piece) -> [DROP & LANDING]
2. [DROP & LANDING] 
   -> (Collides with stack/scale) -> [SEESAW PHYSICS RESOLUTION]
3. [SEESAW PHYSICS RESOLUTION] 
   -> (Tips / Catapults) -> [MATCH DETECTION (3+)]
4. [MATCH DETECTION (3+)] 
   -> (No more matches) -> [GRAVITY & CASCADES] / (Matches found) -> [GRAVITY & CASCADES]
5. [GRAVITY & CASCADES] 
   -> (Blocks fall into gaps) -> [GAME OVER CHECK]
6. [GAME OVER CHECK] 
   -> (Stack height >= M) -> [GAME OVER STATE]

## 3. Detailed Algorithmic Specs

### A. Spawning & Player Input
1. **Active Piece:** A single weighted colored ball spawns at the top of a designated column ($y = M-1$).
2. **Input:** Player can shift the active piece horizontally left/right before committing the drop, or instantly drop it.

### B. Landing & Column Stacking
When a dropped piece falls, it traverses down column $x$ until it collides with the top-most occupied cell ($y_{top}$) or the bottom scale pan ($y = 0$).

### C. The Seesaw Balance & Catapult Engine (Core Mechanic)
Unlike standard stackers, the bottom row ($y=0$) rests on mechanical balance beams (seesaws). 

- **Pairing:** Adjacent columns are grouped into seesaw pairs: $(Col_0, Col_1)$, $(Col_2, Col_3)$, etc. (or a generalized multi-column lever system).
- **Torque / Weight Calculation:**
  - $\text{TotalWeight}_{\text{left}} = \sum_{y=0}^{y_{top}} \text{Block}(Col_{left}, y).\text{weight}$
  - $\text{TotalWeight}_{\text{right}} = \sum_{y=0}^{y_{top}} \text{Block}(Col_{right}, y).\text{weight}$
- **Trigger Condition:** 
  If $|\text{TotalWeight}_{\text{left}} - \text{TotalWeight}_{\text{right}}| \ge \text{Threshold}$ (e.g., weight difference $\ge 3$ units):
  1. The heavier side drops (visual animation).
  2. The lighter side springs upward instantly.
  3. **Catapult Event:** The top-most block on the rising (lighter) stack is ejected. 
  4. **Ejection Vector:** The ejected block is removed from its current stack and launched across the grid into a target landing column (e.g., pushed sideways into an adjacent open stack or bounced back toward the center).

### D. Match Detection & Clearing
- **Rule:** A match triggers when **3 or more blocks of the same color** are adjacent orthogonally (horizontal/vertical) or diagonally.
- **Resolution:** 
  1. Mark matched blocks for deletion.
  2. Play clear animation / particle effect.
  3. Remove blocks from the grid matrix.

### E. Gravity / Cascade Pass
- After blocks are cleared or catapulted, iterate column by column from bottom to top ($y = 0$ to $M-1$).
- If a cell is `null` and the cell directly above it contains a block, drop the upper block down by 1 unit. Repeat until all floating blocks settle.

### F. Chain Reactions
- Once gravity settles the board, **re-run Match Detection**. If new 3+ groups form due to the falling blocks, trigger a cascade chain reaction (awarding multiplier points).
- Once cascades stabilize, return control to the player for the next piece spawn.

### G. Loss Condition (Game Over)
- After all physics resolutions and cascades settle for a dropped piece, check if any column's stack height exceeds $M-1$. If true, transition state to `GAME_OVER`.