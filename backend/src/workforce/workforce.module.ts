import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Skill } from './entities/skill.entity.js';
import { EmployeeSkill } from './entities/employee-skill.entity.js';
import { Shift } from './entities/shift.entity.js';
import { ShiftAssignment } from './entities/shift-assignment.entity.js';
import { Attendance } from './entities/attendance.entity.js';
import { SkillsService } from './skills.service.js';
import { ShiftsService } from './shifts.service.js';
import { SkillsController } from './skills.controller.js';
import { ShiftsController } from './shifts.controller.js';
import { AttendanceController } from './attendance.controller.js';

@Module({
  imports: [TypeOrmModule.forFeature([Skill, EmployeeSkill, Shift, ShiftAssignment, Attendance])],
  controllers: [SkillsController, ShiftsController, AttendanceController],
  providers: [SkillsService, ShiftsService],
  exports: [SkillsService, ShiftsService, TypeOrmModule],
})
export class WorkforceModule {}
