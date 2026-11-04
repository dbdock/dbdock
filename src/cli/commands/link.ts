import { linkProject } from '@/cloud/sync-engine';
import {
  newProjectConfig,
  readProjectConfig,
  writeProjectConfig,
} from '@/cloud/project-config';
import { requireSession } from '@/cloud/session';

export async function linkCommand(options: {
  project?: string;
  name?: string;
}): Promise<void> {
  try {
    if (options.project) {
      const session = await requireSession();
      const project = await session.client.getProject(options.project);
      const current = readProjectConfig();
      if (current?.projectId && current.projectId !== project.publicId)
        throw new Error('This directory is already linked to another project.');
      writeProjectConfig(
        newProjectConfig(
          project.publicId,
          project.organizationId,
          new Date().toISOString(),
        ),
      );
      console.log(`Linked project: ${project.publicId}`);
    } else {
      const { project } = await linkProject(process.cwd(), {
        name: options.name,
      });
      console.log(`Linked project: ${project.publicId}`);
    }
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : 'Project link failed.',
    );
    process.exitCode = 1;
  }
}
