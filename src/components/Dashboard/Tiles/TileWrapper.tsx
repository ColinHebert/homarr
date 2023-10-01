/* eslint-disable react/no-unknown-property */
import { GridItemHTMLElement } from 'fily-publish-gridstack';
import { ReactNode, RefObject } from 'react';
import { GridItemProvider } from '~/components/Board/item/context';

interface GridstackTileWrapperProps {
  id: string;
  type: 'app' | 'widget';
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  itemRef: RefObject<GridItemHTMLElement>;
  children: ReactNode;
}

export const GridstackTileWrapper = ({
  id,
  type,
  x,
  y,
  width,
  height,
  minWidth,
  minHeight,
  maxWidth,
  maxHeight,
  children,
  itemRef,
}: GridstackTileWrapperProps) => {
  const locationProperties = useLocationProperties(x, y);
  const normalizedWidth = width ?? minWidth;
  const normalizedHeight = height ?? minHeight;

  return (
    <GridItemProvider itemRef={itemRef}>
      <div
        className="grid-stack-item"
        data-type={type}
        data-id={id}
        {...locationProperties}
        gs-w={normalizedWidth}
        data-gridstack-w={normalizedWidth}
        gs-h={normalizedHeight}
        data-gridstack-h={normalizedHeight}
        gs-min-w={minWidth}
        gs-min-h={minHeight}
        gs-max-w={maxWidth}
        gs-max-h={maxHeight}
        ref={itemRef as RefObject<HTMLDivElement>}
      >
        {children}
      </div>
    </GridItemProvider>
  );
};

const useLocationProperties = (x: number | undefined, y: number | undefined) => {
  const isLocationDefined = x !== undefined && y !== undefined;

  if (!isLocationDefined) {
    return {
      'gs-auto-position': 'true',
    };
  }

  return {
    'gs-x': x.toString(),
    'data-gridstack-x': x.toString(),
    'gs-y': y.toString(),
    'data-gridstack-y': y.toString(),
  };
};
