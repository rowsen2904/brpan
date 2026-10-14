import { Button, Center, Paper, PasswordInput, Stack, Text, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Logo } from '@/components/Logo';
import { api, auth } from '@/lib/api';

export function LoginPage() {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(false);
    const form = useForm({ initialValues: { username: '', password: '' } });

    const submit = form.onSubmit(async (values) => {
        setLoading(true);
        try {
            const res = await api<{ token: string }>('/api/auth/login', { body: values });
            auth.set(res.token);
            navigate('/');
        } catch {
            setLoading(false);
        }
    });

    return (
        <Center mih="100vh" p="md">
            <Paper w={380} p="xl" className="glass" shadow="xl">
                <form onSubmit={submit}>
                    <Stack>
                        <Center>
                            <Logo size="xl" />
                        </Center>
                        <Text c="dimmed" ta="center" size="sm">
                            Sign in to the control panel
                        </Text>
                        <TextInput label="Username" autoComplete="username" required {...form.getInputProps('username')} />
                        <PasswordInput label="Password" autoComplete="current-password" required {...form.getInputProps('password')} />
                        <Button type="submit" loading={loading} fullWidth mt="sm">
                            Sign in
                        </Button>
                    </Stack>
                </form>
            </Paper>
        </Center>
    );
}
