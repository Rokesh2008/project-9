import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { StudentsService } from './students.service';
import { CreateStudentDto, StudentQueryDto } from './students.dto';

@ApiTags('Students')
@Controller('students')
export class StudentsController {
  constructor(private readonly students: StudentsService) {}

  @Get()
  @Roles('ADMIN', 'PLACEMENT_COORDINATOR', 'PEP_STAFF')
  @ApiOperation({ summary: 'List all students with pagination and search' })
  async findAll(@Query() query: StudentQueryDto) {
    return this.students.findAll(query);
  }

  @Get(':id')
  @Roles('ADMIN', 'PLACEMENT_COORDINATOR', 'PEP_STAFF')
  @ApiOperation({ summary: 'Get student details by ID or studentId' })
  async findOne(@Param('id') id: string) {
    return this.students.findOne(id);
  }

  @Post()
  @Roles('ADMIN', 'PLACEMENT_COORDINATOR')
  @ApiOperation({ summary: 'Create a new student' })
  async create(@Body() dto: CreateStudentDto) {
    return this.students.create(dto);
  }
}
