import { BadRequestException, Controller, Get, Inject, Param, Post, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../../common/auth/jwt-auth.guard";
import { RequireMerchantRole, TenantAccessGuard } from "../../common/tenancy/tenant.guard";
import { type AgentName, AgentsService } from "./agents.service";

const ALLOWED: AgentName[] = ["growth", "recovery", "insights", "checkout"];

@Controller("v1/merchants/:merchantId/agents")
@UseGuards(JwtAuthGuard, TenantAccessGuard)
@RequireMerchantRole("VIEWER")
export class AgentsController {
  constructor(@Inject(AgentsService) private readonly svc: AgentsService) {}

  @Post("run")
  async run(@Param("merchantId") merchantId: string, @Query("agent") agent?: string) {
    if (agent) {
      if (!ALLOWED.includes(agent as AgentName)) throw new BadRequestException(`unknown agent: ${agent}`);
      return { results: { [agent]: await this.svc.run(merchantId, agent as AgentName) } };
    }
    return { results: await this.svc.runAll(merchantId) };
  }

  @Get("opportunities")
  list(@Param("merchantId") merchantId: string, @Query("status") status?: string) {
    return { opportunities: this.svc.listOpportunities(merchantId, status) };
  }
}
