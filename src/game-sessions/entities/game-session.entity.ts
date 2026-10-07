import {
  Entity,
  ManyToOne,
  PrimaryKey,
  Property,
} from '@mikro-orm/decorators/legacy';

import { User } from '../../users/entities/user.entity';
import { Game } from '../../games/entities/game.entity';

@Entity()
export class GameSession {
  @PrimaryKey({ type: 'number' })
  id!: number;

  @ManyToOne(() => User)
  user!: User;

  @ManyToOne(() => Game)
  game!: Game;

  @Property({ type: 'number' })
  durationMinutes!: number;

  @Property({ type: 'datetime' })
  startedAt!: Date;
}