#!/bin/bash

echo "Начинаем деплой сайта в /var/www/html"

# Переходим в директорию
cd /var/www/html

# Сохраняем текущую дату для бэкапа
BACKUP_DATE=$(date +"%Y%m%d_%H%M%S")

# Делаем бэкап текущей версии
echo "Создаем бэкап..."
sudo tar -czf /var/backups/html_backup_$BACKUP_DATE.tar.gz .

# Обновляем файлы
echo "Обновляем файлы из репозитория..."
sudo git fetch origin
sudo git reset --hard origin/main

# Настраиваем права
echo "Настраиваем права доступа..."
sudo chown -R www-data:www-data /var/www/html
sudo chmod -R 755 /var/www/html

echo "Деплой завершен!"
