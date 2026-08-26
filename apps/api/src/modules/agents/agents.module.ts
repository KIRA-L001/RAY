import { Module } from "@nestjs/common";
import { DashboardModule } from "../dashboard/dashboard.module";
import { AgentsController } from "./agents.controller";
import { AgentsService } from "./agents.service";
import { AgentRuntimeService } from "../ai-buyer/agent-runtime.service";

@Module({
  imports: [DashboardModule],
  controllers: [AgentsController],
  providers: [AgentsService, AgentRuntimeService],
})
export class AgentsModule {}
