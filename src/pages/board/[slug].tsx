import { TRPCError } from '@trpc/server';
import { GetServerSideProps, InferGetServerSidePropsType } from 'next';
import { SSRConfig } from 'next-i18next';
import { z } from 'zod';
import { Board } from '~/components/Board/Board';
import { BoardProvider } from '~/components/Board/context';
import { BoardLayout } from '~/components/layout/Templates/BoardLayout';
import { env } from '~/env';
import { createTrpcServersideHelpers } from '~/server/api/helper';
import { getServerAuthSession } from '~/server/auth';
import { getServerSideTranslations } from '~/tools/server/getServerSideTranslations';
import { checkForSessionOrAskForLogin } from '~/tools/server/loginBuilder';
import { boardNamespaces } from '~/tools/server/translation-namespaces';
import { RouterOutputs } from '~/utils/api';

export default function BoardPage({
  board,
  dockerEnabled,
}: InferGetServerSidePropsType<typeof getServerSideProps>) {
  return (
    <BoardProvider initialBoard={board}>
      <BoardLayout dockerEnabled={dockerEnabled}>
        <Board />
      </BoardLayout>
    </BoardProvider>
  );
}

type BoardGetServerSideProps = {
  board: RouterOutputs['boards']['byName'];
  dockerEnabled: boolean;
  _nextI18Next?: SSRConfig['_nextI18Next'];
};

const routeParamsSchema = z.object({
  slug: z.string(),
});

export const getServerSideProps: GetServerSideProps<BoardGetServerSideProps> = async (ctx) => {
  const routeParams = routeParamsSchema.safeParse(ctx.params);
  if (!routeParams.success) {
    return {
      notFound: true,
    };
  }

  const translations = await getServerSideTranslations(
    boardNamespaces,
    ctx.locale,
    ctx.req,
    ctx.res
  );

  const helpers = await createTrpcServersideHelpers(ctx);
  const board = await helpers.boards.byName
    .fetch({ boardName: routeParams.data.slug })
    .catch((err) => {
      if (err instanceof TRPCError && err.code === 'NOT_FOUND') {
        return null;
      }
      throw err;
    });

  if (!board) {
    return {
      notFound: true,
    };
  }

  const session = await getServerAuthSession({ req: ctx.req, res: ctx.res });

  const result = checkForSessionOrAskForLogin(
    ctx,
    session,
    () => board.allowGuests || !!session?.user
  );
  if (result) {
    return result;
  }

  return {
    props: {
      board,
      primaryColor: board.primaryColor,
      secondaryColor: board.secondaryColor,
      primaryShade: board.primaryShade,
      dockerEnabled: !!env.DOCKER_HOST && !!env.DOCKER_PORT,
      ...translations,
    },
  };
};
