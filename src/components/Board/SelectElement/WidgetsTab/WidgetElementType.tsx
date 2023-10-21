import { useModals } from '@mantine/modals';
import { showNotification } from '@mantine/notifications';
import { Icon, IconChecks } from '@tabler/icons-react';
import { useTranslation } from 'next-i18next';
import { WidgetSort } from '~/server/db/items';
import { IWidgetDefinition } from '~/widgets/widgets';

import { useWidgetActions } from '../../Items/Widget/widget-actions';
import { GenericAvailableElementType } from '../Shared/GenericElementType';

interface WidgetElementTypeProps {
  sort: WidgetSort;
  boardName: string;
  image: string | Icon;
  disabled?: boolean;
  widget: IWidgetDefinition;
  modalId: string;
}

export const WidgetElementType = ({
  sort,
  image,
  disabled,
  widget,
  boardName,
  modalId,
}: WidgetElementTypeProps) => {
  const { closeModal } = useModals();
  const { t } = useTranslation(`modules/${sort}`);
  const { createWidget } = useWidgetActions({ boardName });

  const handleAddition = async () => {
    createWidget({
      sort,
      definition: widget,
    });
    closeModal(modalId);
    showNotification({
      title: t('descriptor.name'),
      message: t('descriptor.description'),
      icon: <IconChecks stroke={1.5} />,
      color: 'teal',
    });
  };

  return (
    <GenericAvailableElementType
      name={t('descriptor.name')}
      description={t('descriptor.description') ?? undefined}
      image={image}
      disabled={disabled}
      handleAddition={handleAddition}
    />
  );
};
