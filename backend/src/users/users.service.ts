import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { User } from '../auth/entities/user.entity.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { PageOptionsDto, PageDto, PageMetaDto } from '../common/dto/pagination.dto.js';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async findAll(pageOptions: PageOptionsDto, roleFilter?: string, status?: string): Promise<PageDto<User>> {
    const qb = this.userRepo.createQueryBuilder('user')
      .leftJoinAndSelect('user.role', 'role')
      .orderBy('user.createdAt', pageOptions.order)
      .skip(pageOptions.skip)
      .take(pageOptions.limit);

    if (status === 'inactive') {
      qb.andWhere('user.isActive = :isActive', { isActive: false });
    } else if (status !== 'all') {
      qb.andWhere('user.isActive = :isActive', { isActive: true });
    }

    if (roleFilter) {
      qb.andWhere('role.name = :role', { role: roleFilter });
    }

    const [items, count] = await qb.getManyAndCount();
    const meta = new PageMetaDto(pageOptions, count);
    return new PageDto(items, meta);
  }

  async findOne(id: string): Promise<User> {
    const user = await this.userRepo.findOne({ where: { id }, relations: ['role'] });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async create(dto: CreateUserDto): Promise<User> {
    const conditions: any[] = [{ employeeId: dto.employeeId }];
    if (dto.email) conditions.push({ email: dto.email });
    const exists = await this.userRepo.findOne({ where: conditions });
    if (exists) throw new ConflictException('User with this email or employee ID already exists');
    const hash = await bcrypt.hash(dto.password, 10);
    const user = this.userRepo.create({
      employeeId: dto.employeeId,
      email: dto.email || null,
      mobileNo: dto.mobileNo,
      passwordHash: hash,
      firstName: dto.firstName,
      lastName: dto.lastName,
      roleId: dto.roleId,
    });
    const saved = await this.userRepo.save(user);
    return this.findOne(saved.id);
  }

  async update(id: string, dto: UpdateUserDto): Promise<User> {
    const user = await this.findOne(id);
    if (dto.password) {
      (user as any).passwordHash = await bcrypt.hash(dto.password, 10);
    }
    if (dto.email !== undefined) user.email = dto.email;
    if (dto.mobileNo !== undefined) user.mobileNo = dto.mobileNo;
    if (dto.firstName !== undefined) user.firstName = dto.firstName;
    if (dto.lastName !== undefined) user.lastName = dto.lastName;
    if (dto.roleId !== undefined) user.roleId = dto.roleId;
    if (dto.isActive !== undefined) user.isActive = dto.isActive;
    await this.userRepo.save(user);
    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    const user = await this.findOne(id);
    user.isActive = false;
    await this.userRepo.save(user);
  }
}
