import { HttpClient } from "../http-client.js";
import type { Config } from "../../config/types/config.js";
export class GitlabClient {
  private readonly http: HttpClient;
  private readonly project: string;
  constructor(config: NonNullable<Config["gitlab"]>, token: string) {
    this.http = new HttpClient(config.baseUrl, { "PRIVATE-TOKEN": token });
    this.project = "/api/v4/projects/" + encodeURIComponent(config.projectId);
  }
  async readiness(
    revision: string,
    stagingRef: string,
  ): Promise<{ pipelineId: number; deploymentId: number }> {
    const branch = await this.http.request(
      `${this.project}/repository/branches/${encodeURIComponent(stagingRef)}`,
    );
    if (branch.commit.id !== revision)
      throw new Error(
        "Staging branch no longer points to the expected revision",
      );
    const pipelines = await this.http.request(
      `${this.project}/pipelines?sha=${encodeURIComponent(revision)}&ref=${encodeURIComponent(stagingRef)}&per_page=100&order_by=id&sort=desc`,
    );
    const pipeline = pipelines[0];
    if (!pipeline || pipeline.sha !== revision || pipeline.status !== "success")
      throw new Error("Expected revision has no successful staging pipeline");
    const deployments = await this.http.request(
      `${this.project}/deployments?status=success&order_by=id&sort=desc&per_page=100`,
    );
    const deployment = deployments.find(
      (d: any) => d.environment?.name === "staging",
    );
    if (!deployment || deployment.sha !== revision)
      throw new Error(
        "No verified successful deployment of the expected revision to staging",
      );
    return { pipelineId: pipeline.id, deploymentId: deployment.id };
  }
  async findDraft(branch: string, marker: string): Promise<any | undefined> {
    let page = 1;
    for (;;) {
      const results = await this.http.request(
        `${this.project}/merge_requests?source_branch=${encodeURIComponent(branch)}&target_branch=master&state=opened&per_page=100&page=${page++}`,
      );
      const found = results.find((mr: any) => mr.description?.includes(marker));
      if (found) return found;
      if (results.length < 100) return undefined;
    }
  }
  async ready(iid: number, expectedHead: string): Promise<void> {
    const mr = await this.http.request(`${this.project}/merge_requests/${iid}`);
    if (mr.target_branch !== "master" || mr.sha !== expectedHead)
      throw new Error(
        "MR revision or target changed since human staging validation",
      );
    if (!mr.draft && !/^Draft:|^WIP:/i.test(mr.title)) return;
    await this.http.request(`${this.project}/merge_requests/${iid}`, "PUT", {
      title: mr.title.replace(/^(?:Draft:|WIP:)\s*/i, ""),
    });
    const verified = await this.http.request(
      `${this.project}/merge_requests/${iid}`,
    );
    if (verified.draft) throw new Error("MR remains draft");
  }
  async draft(
    branch: string,
    title: string,
    description: string,
  ): Promise<any> {
    const result = await this.http.request(
      `${this.project}/merge_requests`,
      "POST",
      {
        source_branch: branch,
        target_branch: "master",
        title: "Draft: " + title,
        description,
        remove_source_branch: false,
      },
    );
    if (
      !Number.isInteger(result.iid) ||
      result.iid < 1 ||
      result.source_branch !== branch ||
      result.target_branch !== "master" ||
      result.draft !== true
    )
      throw new Error(
        "GitLab did not confirm the expected draft MR; reconcile the pending effect",
      );
    return result;
  }
}
