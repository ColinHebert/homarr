import { Grid, Text } from '@mantine/core';
import { useTranslation } from 'next-i18next';
import { objectEntries } from '~/tools/object';

import widgets from '../../../../widgets';
import { SelectorBackArrow } from '../Shared/SelectorBackArrow';
import { WidgetElementType } from './WidgetElementType';

interface AvailableIntegrationElementsProps {
  modalId: string;
  boardName: string;
  onClickBack: () => void;
}

export const AvailableIntegrationElements = ({
  modalId,
  boardName,
  onClickBack,
}: AvailableIntegrationElementsProps) => {
  const { t } = useTranslation('layout/element-selector/selector');
  return (
    <>
      <SelectorBackArrow onClickBack={onClickBack} />

      <Text mb="md" color="dimmed">
        {t('widgetDescription')}
      </Text>

      <Grid>
        {objectEntries(widgets).map(([k, v]) => (
          <WidgetElementType
            key={k}
            sort={k}
            boardName={boardName}
            image={v.icon}
            widget={v}
            modalId={modalId}
          />
        ))}
      </Grid>
    </>
  );
};
