import { ActionIcon, Badge, Button, Chip, Group, Modal, Paper, SimpleGrid, Stack, Text, TextInput, Title, Tooltip } from '@mantine/core';
import { modals } from '@mantine/modals';
import { IconEdit, IconPlus, IconTrash, IconUsersGroup } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { api, notifyOk } from '@/lib/api';
import { PROTOCOL_META, PROTOCOLS, type Protocol, type Squad } from '@/lib/types';

function SquadModal({ squad, opened, onClose }: { squad: Squad | null; opened: boolean; onClose: () => void }) {
    const qc = useQueryClient();
    const [name, setName] = useState('');
    const [protocols, setProtocols] = useState<Protocol[]>([]);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!opened) return;
        setName(squad?.name ?? '');
        setProtocols(squad?.protocols ?? [...PROTOCOLS]);
    }, [opened, squad]);

    const save = async () => {
        setSaving(true);
        try {
            if (squad) await api(`/api/squads/${squad.id}`, { method: 'PATCH', body: { name, protocols } });
            else await api('/api/squads', { body: { name, protocols } });
            notifyOk(squad ? 'Squad updated, members resynced' : 'Squad created');
            await qc.invalidateQueries({ queryKey: ['squads'] });
            await qc.invalidateQueries({ queryKey: ['users'] });
            onClose();
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal opened={opened} onClose={onClose} title={squad ? `Edit ${squad.name}` : 'New squad'} centered>
            <Stack>
                <TextInput label="Name" placeholder="Main" value={name} onChange={(e) => setName(e.currentTarget.value)} />
                <div>
                    <Text size="sm" fw={500} mb={6}>
                        Protocols
                    </Text>
                    <Chip.Group multiple value={protocols} onChange={(v) => setProtocols(v as Protocol[])}>
                        <Group gap={6}>
                            {PROTOCOLS.map((p) => (
                                <Chip key={p} value={p} size="xs" color={PROTOCOL_META[p].color} variant="light">
                                    {PROTOCOL_META[p].label}
                                </Chip>
                            ))}
                        </Group>
                    </Chip.Group>
                </div>
                <Group justify="flex-end">
                    <Button variant="default" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button onClick={save} loading={saving} disabled={!name.trim()}>
                        Save
                    </Button>
                </Group>
            </Stack>
        </Modal>
    );
}

export function SquadsPage() {
    const qc = useQueryClient();
    const { data: squads = [] } = useQuery({ queryKey: ['squads'], queryFn: () => api<Squad[]>('/api/squads') });
    const [edit, setEdit] = useState<Squad | null>(null);
    const [opened, setOpened] = useState(false);

    const open = (squad: Squad | null) => {
        setEdit(squad);
        setOpened(true);
    };

    const remove = (squad: Squad) =>
        modals.openConfirmModal({
            title: `Delete ${squad.name}`,
            children: (
                <Text size="sm">
                    {squad.members} user(s) are in this squad. They lose its protocols; users with no squads left get no servers.
                </Text>
            ),
            labels: { confirm: 'Delete', cancel: 'Cancel' },
            confirmProps: { color: 'red' },
            onConfirm: async () => {
                await api(`/api/squads/${squad.id}`, { method: 'DELETE' });
                notifyOk('Squad deleted');
                await qc.invalidateQueries({ queryKey: ['squads'] });
                await qc.invalidateQueries({ queryKey: ['users'] });
            },
        });

    return (
        <Stack>
            <Group justify="space-between">
                <Title order={3}>Squads</Title>
                <Button leftSection={<IconPlus size={16} />} onClick={() => open(null)}>
                    New squad
                </Button>
            </Group>
            <Text size="sm" c="dimmed">
                A squad is a set of protocols. Tick squads when creating a user — they get the servers of every squad they are in. Editing a squad updates all
                its members instantly.
            </Text>
            <SimpleGrid cols={{ base: 1, md: 2, lg: 3 }}>
                {squads.map((sq) => (
                    <Paper key={sq.id} withBorder p="md" className="glass">
                        <Group justify="space-between" mb="xs">
                            <Group gap={8}>
                                <IconUsersGroup size={18} />
                                <Text fw={600}>{sq.name}</Text>
                                <Badge variant="light" size="sm">
                                    {sq.members} users
                                </Badge>
                            </Group>
                            <Group gap={4}>
                                <Tooltip label="Edit">
                                    <ActionIcon variant="subtle" onClick={() => open(sq)}>
                                        <IconEdit size={16} />
                                    </ActionIcon>
                                </Tooltip>
                                <Tooltip label="Delete">
                                    <ActionIcon variant="subtle" color="red" onClick={() => remove(sq)}>
                                        <IconTrash size={16} />
                                    </ActionIcon>
                                </Tooltip>
                            </Group>
                        </Group>
                        <Group gap={4}>
                            {sq.protocols.length ? (
                                sq.protocols.map((p) => (
                                    <Badge key={p} size="xs" variant="dot" color={PROTOCOL_META[p].color}>
                                        {PROTOCOL_META[p].label}
                                    </Badge>
                                ))
                            ) : (
                                <Text size="xs" c="dimmed">
                                    No protocols
                                </Text>
                            )}
                        </Group>
                    </Paper>
                ))}
            </SimpleGrid>
            <SquadModal squad={edit} opened={opened} onClose={() => setOpened(false)} />
        </Stack>
    );
}
