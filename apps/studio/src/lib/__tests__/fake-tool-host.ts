// A ToolHost for tests: records what a tool posts, asks and proposes, over a
// real workspace folder. Shared by the tool and drawing tests.

import { join } from "node:path";
import { listWorkspace } from "@toony/project-io";
import type { AgentPreferences, ConversationItem, TaskItem } from "../agent/protocol.js";
import type { StoredProposal, ToolHost } from "../agent/tools/run.js";

export class FakeHost implements ToolHost {
  readonly conversationId = "11111111-2222-3333-4444-555555555555";
  turnId = "turn-1";
  items: ConversationItem[] = [];
  tasks: TaskItem[] = [];
  proposals: StoredProposal[] = [];
  navigations: string[] = [];
  rebinds: string[] = [];
  undone: string[] = [];
  isWaiting = false;
  prefs: AgentPreferences = {
    provider: "codex",
    model: "",
    autoApply: true,
    viewArtwork: true,
    retainHistory: true,
  };
  constructor(
    readonly workspace: string,
    public work: string | null,
  ) {}
  workId() {
    return this.work;
  }
  preferences() {
    return this.prefs;
  }
  async resolveWork(id: string) {
    const works = await listWorkspace(this.workspace);
    return works.some((w) => w.id === id) ? { id, root: join(this.workspace, id) } : null;
  }
  async listWorks() {
    return (await listWorkspace(this.workspace)).map((w) => ({
      id: w.id,
      title: w.title,
      episodeCount: w.episodeCount,
    }));
  }
  item(item: ConversationItem) {
    const index = this.items.findIndex((i) => i.id === item.id);
    if (index === -1) this.items.push(item);
    else this.items[index] = item;
  }
  changeUndone(changeId: string) {
    this.undone.push(changeId);
  }
  async setTasks(tasks: TaskItem[]) {
    this.tasks = tasks;
  }
  conversationTasks() {
    return this.tasks;
  }
  texts: string[] = [];
  openQuestions() {
    return [];
  }
  userTexts() {
    return this.texts;
  }
  since() {
    return null;
  }
  navigate(href: string) {
    this.navigations.push(href);
  }
  async rebind(workId: string) {
    this.work = workId;
    this.rebinds.push(workId);
  }
  waiting() {
    this.isWaiting = true;
  }
  addProposal(proposal: StoredProposal) {
    this.proposals.push(proposal);
  }
  touch() {}
  live = true;
  followUps: string[] = [];
  canWait() {
    return this.live;
  }
  followUp(text: string) {
    this.followUps.push(text);
  }
}
