import { Injectable } from '@nestjs/common';
import { EntityRepository } from '@mikro-orm/postgresql';
import { InjectRepository } from '@mikro-orm/nestjs';
import { User } from './entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: EntityRepository<User>,
  ) { }

  async findAll() {
    return this.userRepository.findAll();
  }

  async findOne(id: number) {
    return this.userRepository.findOne({ id });
  }

  async create(createUserDto: CreateUserDto) {
    const user = this.userRepository.create(createUserDto);

    await this.userRepository.getEntityManager().flush();

    return user;
  }

  async remove(id: number) {
    const user = await this.userRepository.findOne({ id });

    if (!user) {
      return null;
    }

    await this.userRepository.getEntityManager().remove(user).flush();

    return user;
  }

  async update(id: number, updateUserDto: UpdateUserDto) {
    const user = await this.userRepository.findOne({ id });

    if (!user) {
      return null;
    }

    this.userRepository.assign(user, updateUserDto);

    await this.userRepository.getEntityManager().flush();

    return user;
  }

}