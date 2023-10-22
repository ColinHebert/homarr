import { TRPCError } from '@trpc/server';
import { randomUUID } from 'crypto';
import { and, eq, inArray } from 'drizzle-orm';
import fs from 'fs';
import { z } from 'zod';
import { db } from '~/server/db';
import { WidgetSort } from '~/server/db/items';
import { getDefaultBoardAsync } from '~/server/db/queries/userSettings';
import {
  appStatusCodes,
  apps,
  boards,
  items,
  layoutItems,
  layouts,
  sections,
  widgetOptions,
  widgets,
} from '~/server/db/schema';
import { configExists } from '~/tools/config/configExists';
import { getConfig } from '~/tools/config/getConfig';
import { getFrontendConfig } from '~/tools/config/getFrontendConfig';
import { generateDefaultApp } from '~/tools/shared/app';
import { appSchema } from '~/validations/app';
import { boardCustomizationSchema, createBoardSchema } from '~/validations/boards';
import { isMobileUserAgent } from '~/validations/mobile';
import { sectionSchema } from '~/validations/section';
import { widgetSchema } from '~/validations/widget';

import { adminProcedure, createTRPCRouter, protectedProcedure, publicProcedure } from '../trpc';
import { createBoardSaveDbChanges } from './board/db';
import {
  applyCreateAppChanges,
  applyUpdateAppChanges,
  getAppsForSectionsAsync,
} from './board/db/app';
import { getFullBoardWithLayoutSectionsAsync } from './board/db/board';
import { addLayoutAsync } from './board/db/layout';
import {
  applyCreateWidgetChanges,
  applyUpdateWidgetChanges,
  getWidgetsForSectionsAsync,
} from './board/db/widget';
import { mapApp } from './board/mapping/app';
import { mapSection } from './board/mapping/section';
import { mapWidget } from './board/mapping/widget';
import { configNameSchema } from './config';

export const boardRouter = createTRPCRouter({
  all: protectedProcedure.query(async ({ ctx }) => {
    const files = fs.readdirSync('./data/configs').filter((file) => file.endsWith('.json'));
    const dbBoards = await db.query.boards.findMany({
      columns: {
        name: true,
      },
      with: {
        items: true,
      },
    });

    const defaultBoard = await getDefaultBoardAsync(ctx.session.user.id, 'default');

    const result = await Promise.all(
      files.map(async (file) => {
        const name = file.replace('.json', '');
        const config = await getFrontendConfig(name);

        const countApps = config.apps.length;

        return {
          name: name,
          countApps: countApps,
          countWidgets: config.widgets.length,
          countCategories: config.categories.length,
          isDefaultForUser: name === defaultBoard,
          type: 'file',
        };
      })
    );

    return result.concat(
      dbBoards.map((x) => ({
        name: x.name,
        countApps: x.items.filter((x) => x.kind === 'app').length,
        countWidgets: x.items.filter((x) => x.kind === 'widget').length,
        countCategories: 0, // TODO: Is different depending on layout
        isDefaultForUser: x.name === defaultBoard,
        type: 'db',
      }))
    );
  }),
  addAppsForContainers: adminProcedure
    .input(
      z.object({
        boardName: configNameSchema,
        apps: z.array(
          z.object({
            name: z.string(),
            port: z.number().optional(),
          })
        ),
      })
    )
    .mutation(async ({ input }) => {
      if (!(await configExists(input.boardName))) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Board not found',
        });
      }
      const config = await getConfig(input.boardName);

      const lowestWrapper = config?.wrappers.sort((a, b) => a.position - b.position)[0];

      const newConfig = {
        ...config,
        apps: [
          ...config.apps,
          ...input.apps.map((container) => {
            const defaultApp = generateDefaultApp(lowestWrapper.id);
            const address = container.port
              ? `http://localhost:${container.port}`
              : 'http://localhost';

            return {
              ...defaultApp,
              name: container.name,
              url: address,
              behaviour: {
                ...defaultApp.behaviour,
                externalUrl: address,
              },
            };
          }),
        ],
      };

      const targetPath = `data/configs/${input.boardName}.json`;
      fs.writeFileSync(targetPath, JSON.stringify(newConfig, null, 2), 'utf8');
    }),
  byName: publicProcedure
    .input(z.object({ boardName: configNameSchema, layoutId: z.string().optional() }))
    .query(async ({ input }) => {
      const board = await getFullBoardWithLayoutSectionsAsync(
        {
          key: 'name',
          value: input.boardName,
        },
        input.layoutId
      );

      if (!board) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Board not found',
        });
      }

      const layout = board.layouts.at(0);
      if (!layout) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Layout not found',
        });
      }
      const sectionIds = layout.sections.map((x) => x.id);
      const apps = await getAppsForSectionsAsync(sectionIds);
      const widgets = await getWidgetsForSectionsAsync(sectionIds);

      const preparedSections = layout.sections.map((section) => {
        const filteredApps = apps.filter((x) =>
          x.item.layouts.some((y) => y.sectionId === section.id)
        );
        const filteredWidgets = widgets.filter((x) =>
          x.item.layouts.some((y) => y.sectionId === section.id)
        );
        return mapSection(section, [
          ...filteredApps.map(mapApp),
          ...filteredWidgets.map(mapWidget),
        ]);
      });
      const { layouts, ...withoutLayouts } = board;
      return {
        ...withoutLayouts,
        layoutName: layout.name,
        layoutId: layout.id,
        showRightSidebar: layout.showRightSidebar,
        showLeftSidebar: layout.showLeftSidebar,
        sections: preparedSections,
      };
    }),
  byNameSimple: publicProcedure
    .input(z.object({ boardName: configNameSchema }))
    .query(async ({ input }) => {
      const board = await db.query.boards.findFirst({
        where: eq(boards.name, input.boardName),
      });

      if (!board) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Board not found',
        });
      }
      return board;
    }),
  updateCustomization: protectedProcedure
    .input(z.object({ boardName: configNameSchema, customization: boardCustomizationSchema }))
    .mutation(async ({ input }) => {
      const dbBoard = await db.query.boards.findFirst({
        where: eq(boards.name, input.boardName),
      });

      if (!dbBoard) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Board not found',
        });
      }

      await db
        .update(boards)
        .set({
          allowGuests: input.customization.access.allowGuests,
          isPingEnabled: input.customization.network.pingsEnabled,
          appOpacity: input.customization.appearance.opacity,
          backgroundImageUrl: input.customization.appearance.backgroundSrc,
          primaryColor: input.customization.appearance.primaryColor,
          secondaryColor: input.customization.appearance.secondaryColor,
          customCss: input.customization.appearance.customCss,
          pageTitle: input.customization.pageMetadata.pageTitle,
          metaTitle: input.customization.pageMetadata.metaTitle,
          logoImageUrl: input.customization.pageMetadata.logoSrc,
          faviconImageUrl: input.customization.pageMetadata.faviconSrc,
          primaryShade: input.customization.appearance.shade,
        })
        .where(eq(boards.id, dbBoard.id));

      return dbBoard;
    }),
  create: adminProcedure.input(createBoardSchema).mutation(async ({ ctx, input }) => {
    const existingBoard = await db.query.boards.findFirst({
      where: eq(boards.name, input.boardName),
    });

    if (existingBoard) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'Board already exists',
      });
    }

    const isMobile = isMobileUserAgent(ctx.headers['user-agent'] ?? '');
    const boardId = randomUUID();
    await db.insert(boards).values({
      id: boardId,
      name: input.boardName,
      pageTitle: input.pageTitle,
      allowGuests: input.allowGuests,
      ownerId: ctx.session.user.id,
    });

    const mobileLayout = await addLayoutAsync({
      boardId,
      name: 'Mobile layout',
      kind: 'mobile',
    });

    const desktopLayout = await addLayoutAsync({
      boardId,
      name: 'Desktop layout',
      kind: 'desktop',
    });

    if (isMobile) {
      return mobileLayout;
    }
    return desktopLayout;
  }),
  checkNameAvailable: adminProcedure
    .input(z.object({ boardName: configNameSchema }))
    .query(async ({ input }) => {
      const board = await db.query.boards.findFirst({
        where: eq(boards.name, input.boardName),
      });

      return !board;
    }),
  save: adminProcedure
    .input(
      z.object({
        boardId: z.string(),
        layoutId: z.string(),
        sections: z.array(sectionSchema),
      })
    )
    .mutation(async ({ input }) => {
      const boardWithSections = await db.query.boards.findFirst({
        where: eq(boards.id, input.boardId),
        with: {
          layouts: {
            where: eq(layouts.id, input.layoutId),
            with: {
              sections: true,
            },
          },
        },
      });

      if (!boardWithSections) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Board not found',
        });
      }

      const layout = boardWithSections.layouts.at(0);
      if (!layout) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Layout not found',
        });
      }

      const changes = createBoardSaveDbChanges();

      const dbSections = layout.sections;
      const dbSectionIds = dbSections.map((x) => x.id);

      // Insert new sections
      const newSections = input.sections
        .filter((s) => dbSections.every((x) => x.id !== s.id))
        .map((section) => ({
          id: section.id,
          layoutId: layout.id,
          kind: section.kind,
          position: parseSectionPosition(section.position),
          name: section.kind === 'category' ? section.name : null,
        }));
      changes.sections.create.push(...newSections);

      // Update existing sections
      const updatedSections = input.sections
        .filter((s) =>
          dbSections.some(
            (x) =>
              x.id === s.id &&
              (x.position !== s.position || (s.kind === 'category' && x.name !== s.name))
          )
        )
        .map((section) => ({
          position: parseSectionPosition(section.position),
          name: section.kind === 'category' ? section.name : null,
          _where: section.id,
        }));
      changes.sections.update.push(...updatedSections);

      const dbItemsApps = await db.query.items.findMany({
        where: and(eq(items.boardId, boardWithSections.id), eq(items.kind, 'app')),
        with: {
          layouts: {
            where:
              dbSectionIds.length >= 1 ? inArray(layoutItems.sectionId, dbSectionIds) : undefined,
          },
          app: {
            with: {
              statusCodes: {
                columns: {
                  code: true,
                },
              },
            },
          },
        },
      });
      const inputApps = input.sections.flatMap((s) =>
        s.items
          .filter((i): i is z.infer<typeof appSchema> => i.kind === 'app')
          .map((i) => ({ ...i, sectionId: s.id }))
      );

      const newApps = inputApps.filter((x) => dbItemsApps.every((y) => y.id !== x.id));
      newApps.forEach(({ sectionId, ...app }) =>
        applyCreateAppChanges(changes, app, input.boardId, sectionId)
      );

      const updatedApps = inputApps.filter((s) => dbItemsApps.some((x) => x.id === s.id));
      updatedApps.forEach(({ sectionId, ...app }) =>
        applyUpdateAppChanges(
          changes,
          app,
          dbItemsApps.find((a) => a.id === app.id)?.app?.statusCodes.map((x) => x.code) ?? [],
          sectionId
        )
      );

      const removedAppIds = dbItemsApps
        .filter((app) => inputApps.every((x) => x.id !== app.id))
        .map((a) => a.id);
      changes.items.delete.push(...removedAppIds);

      const dbItemsWidgets = await db.query.items.findMany({
        where: and(eq(items.boardId, boardWithSections.id), eq(items.kind, 'widget')),
        with: {
          layouts: {
            where:
              dbSectionIds.length >= 1 ? inArray(layoutItems.sectionId, dbSectionIds) : undefined,
          },
          widget: {
            with: {
              options: true,
            },
          },
        },
      });
      const inputWidgets = input.sections.flatMap((s) =>
        s.items
          .filter((i): i is z.infer<typeof widgetSchema> => i.kind === 'widget')
          .map((i) => ({ ...i, sectionId: s.id }))
      );

      const newWidgets = inputWidgets.filter((x) => dbItemsWidgets.every((y) => y.id !== x.id));
      newWidgets.forEach(({ sectionId, ...widget }) =>
        applyCreateWidgetChanges(changes, widget, input.boardId, sectionId)
      );

      const updatedWidgets = inputWidgets.filter((s) => dbItemsWidgets.some((x) => x.id === s.id));
      updatedWidgets.forEach(({ sectionId, ...widget }) =>
        applyUpdateWidgetChanges(
          changes,
          widget,
          dbItemsWidgets.find((a) => a.id === widget.id)?.widget?.options ?? [],
          sectionId
        )
      );

      const removedWidgetIds = dbItemsWidgets
        .filter((widget) => inputWidgets.every((x) => x.id !== widget.id))
        .map((w) => w.id);
      changes.items.delete.push(...removedWidgetIds);

      await db.transaction(async (tx) => {
        // Insert
        if (changes.sections.create.length > 0) {
          await tx.insert(sections).values(changes.sections.create);
        }
        if (changes.items.create.length > 0) {
          await tx.insert(items).values(changes.items.create);
        }
        if (changes.layoutItems.create.length > 0) {
          await tx.insert(layoutItems).values(changes.layoutItems.create);
        }
        if (changes.apps.create.length > 0) {
          await tx.insert(apps).values(changes.apps.create);
        }
        console.log('before appStatusCodes');
        if (changes.appStatusCodes.create.length > 0) {
          await tx.insert(appStatusCodes).values(changes.appStatusCodes.create);
        }
        if (changes.widgets.create.length > 0) {
          await tx.insert(widgets).values(changes.widgets.create);
        }
        if (changes.widgetOptions.create.length > 0) {
          await tx.insert(widgetOptions).values(changes.widgetOptions.create);
        }
        // Update
        for (const { _where, ...section } of changes.sections.update) {
          await tx.update(sections).set(section).where(eq(sections.id, _where));
        }
        for (const { _where, ...item } of changes.items.update) {
          await tx.update(items).set(item).where(eq(items.id, _where));
        }
        for (const { _where, ...layoutItem } of changes.layoutItems.update) {
          await tx.update(layoutItems).set(layoutItem).where(eq(layoutItems.itemId, _where));
        }
        for (const { _where, ...app } of changes.apps.update) {
          await tx.update(apps).set(app).where(eq(apps.itemId, _where));
        }
        for (const { _where, ...widget } of changes.widgets.update) {
          await tx.update(widgets).set(widget).where(eq(widgets.itemId, _where));
        }
        for (const { _where, ...widgetOption } of changes.widgetOptions.update) {
          await tx.update(widgetOptions).set(widgetOption).where(eq(widgetOptions.path, _where));
        }
        // Delete
        if (changes.items.delete.length > 0) {
          await tx.delete(items).where(inArray(items.id, changes.items.delete));
        }
        for (const { code, appId } of changes.appStatusCodes.delete) {
          await tx
            .delete(appStatusCodes)
            .where(and(eq(appStatusCodes.appId, appId), eq(appStatusCodes.code, code)));
        }
        if (changes.sections.delete.length > 0) {
          await tx.delete(sections).where(inArray(sections.id, changes.sections.delete));
        }
      });
    }),
});

const parseSectionPosition = (position: z.infer<typeof sectionSchema>['position']) => {
  if (position === 'left') return 0;
  if (position === 'right') return 1;
  return position;
};
